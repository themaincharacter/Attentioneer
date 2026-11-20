import { useEffect, useRef } from "react";
import type { CommandAct } from "../commands/acts";
import type { CommandRun } from "../commands/execute";
import type { InterpreterRead } from "../commands/interpreter";
import type { Level } from "../workspace/level";

/**
 * STORY 21.3 — THE COMMAND CARD (ADR-0038 decisions 1, 4 and 5).
 *
 * A closed-by-default floating card at the bottom of the app, on EVERY map. It
 * holds one instruction field, the interpreter's answer, and — when the answer
 * was a script — the acts as a SHORT numbered list in plain words, with accept
 * and refuse. Nothing else on the screen changes.
 *
 * ONE PRESS (ADR-0038 decision 4). The script preview IS the ghost preview: the
 * person's accept on this list is the acceptance of every ghost the acts file,
 * so the card never asks a second time. That is the whole reason the preview
 * exists. The accept handler calls the app's one apply seam ONCE and nothing in
 * this file opens a confirmation.
 *
 * NO NUDGE (ADR-0038 decision 1, AGENTS.md's guardrail). Closed by default. No
 * badge, no pulse, no unread marker, no auto-open effect, no volunteered
 * suggestion and no timer: the flag starts false and only the person's press
 * sets it true. Nothing here watches the map for something to say.
 *
 * A REFUSAL MOVES NOTHING. The interpreter has already written its ONE Move
 * (commands/interpreterCall.ts); refusing the script discards the view and
 * writes nothing else, so the refusal's only record is that egress.
 *
 * ON ANOTHER MAP, ONE HONEST SENTENCE (ADR-0038 decision 1's "every map" and
 * the story's scope): the card is present everywhere, but the vocabulary only
 * names the ground map for now, so elsewhere it says so and offers NO acts, no
 * accept and no refuse. It does not pretend the map can be changed yet.
 *
 * FOCUS AND SCROLL. The card is a non-modal section, never a focus trap: Tab
 * moves out of it, and Esc closes it. Its BODY is the only scroll region (the
 * map does not scroll under it), and a wheel over the card stays on the card.
 *
 * PROVISIONAL (ADR-0038's consequences): the card's look and placement, its
 * invitation wording, the act list's plain-word phrasing, the non-ground map
 * sentence, and the failure sentence's shape.
 */

/** The closed bar's one line of invitation (PROVISIONAL). */
export const COMMAND_INVITATION = "tell the app what to change";

/** The open card's quiet title (PROVISIONAL). */
export const COMMAND_TITLE = "command";

/** The one sentence another map gets instead of acts (PROVISIONAL). */
export const COMMAND_NON_GROUND_SENTENCE =
  "commands only change the ground map for now.";

/** The one quiet line a refusal leaves (PROVISIONAL). */
export const COMMAND_REFUSED_SENTENCE = "nothing was applied.";

/**
 * The one quiet line a completed script leaves (PROVISIONAL). It says the acts
 * RAN, not that the map changed: a script may be all reads, and a read changes
 * nothing.
 */
export const COMMAND_APPLIED_SENTENCE = "those acts ran.";

/** The quiet line while the interpreter reads the instruction (PROVISIONAL). */
export const COMMAND_READING_SENTENCE = "reading the instruction…";

/** The quiet line while the script's ghosts are applied (PROVISIONAL). */
export const COMMAND_APPLYING_SENTENCE = "applying the acts…";

/** The one sentence a second clarifying question leaves (PROVISIONAL). */
export const COMMAND_SECOND_QUESTION_SENTENCE =
  "it asked again, so nothing was applied.";

/** The one sentence a script that never ran leaves (PROVISIONAL). */
export const COMMAND_FAILED_SENTENCE = "nothing was applied.";

/** The one sentence a refused ghost leaves (PROVISIONAL). */
export const COMMAND_GHOST_REFUSAL_PREFIX = "the app refused one of the script's ghosts: ";

/**
 * WHAT THE PERSON'S ACCEPT MEANS (ADR-0038 decision 4). The script preview is
 * the ghost preview: accepting it applies its acts, and there is no second
 * question. This sentence is the accept verb's title, so the rule is in code
 * and in the place a hand can read it.
 */
export const COMMAND_ONE_PRESS =
  "accepting this script applies its acts; this preview is the ghost preview";

/** The accept, refuse, read and answer verbs (PROVISIONAL wording). */
export const COMMAND_ACCEPT_VERB = "accept and apply";
export const COMMAND_REFUSE_VERB = "refuse";
export const COMMAND_READ_VERB = "read the instruction";
export const COMMAND_ANSWER_VERB = "answer";

/** The quiet "you said" label above the last instruction (PROVISIONAL). */
export const COMMAND_LAST_LABEL = "you said: ";

/** What the card is waiting on, or null when it is not waiting (view state). */
export type CommandBusy = "reading" | "applying" | null;

/** What the interpreter answered, as the card shows it. */
export type CommandView =
  | { kind: "acts"; instruction: string; acts: readonly CommandAct[] }
  | {
      kind: "question";
      instruction: string;
      question: string;
      /** The one answer was given: a second question is shown, not asked again. */
      answered: boolean;
    }
  | { kind: "problem"; instruction: string; sentence: string }
  | { kind: "applied"; instruction: string; acts: readonly CommandAct[] }
  | { kind: "failed"; instruction: string; sentence: string }
  | { kind: "refused"; instruction: string };

export interface CommandCardProps {
  /** The map on screen. The card is present on every map (ADR-0038 §1). */
  level: Level;
  /** Closed by default; the app's state starts false and only a press opens it. */
  open: boolean;
  /** The person's instruction, verbatim, while it is being typed. */
  instruction: string;
  /** The clarifying answer, while the one question is being answered. */
  answer: string;
  /** The interpreter's answer or the last outcome, or null before one. */
  view: CommandView | null;
  /** The wait, or null when the card is not waiting on anything. */
  busy: CommandBusy;
  onOpen(): void;
  onClose(): void;
  onInstruction(value: string): void;
  onAnswer(value: string): void;
  onInterpret(): void;
  onAnswerQuestion(): void;
  onAccept(): void;
  onRefuse(): void;
}

/** Is a command allowed to name this map at all? (PROVISIONAL: ground only.) */
export function commandMapLive(level: Level): boolean {
  return level === "ground";
}

/**
 * THE MOVE'S ANCHOR (ADR-0038 decision 2's PRISM, one per egress). The
 * interpreter's Move is anchored on the MAP the person is looking at — the
 * person's act happens there. A command card is not a card record, so when no
 * card is open the map itself is the anchor and its word is the level.
 */
export function commandAnchor(level: Level): string {
  return level;
}

/** One act as a plain line the list can carry (PROVISIONAL phrasing). */
export function actLine(act: CommandAct): string {
  const payload = act.payload;
  const text = (key: string): string => String(payload[key] ?? "");
  switch (act.act) {
    case "map_overview":
      return "read the map";
    case "read_card":
      return "read " + text("card");
    case "read_wires":
      return "read the wires";
    case "propose_card":
      return "add a card " + JSON.stringify(text("name"));
    case "propose_wire":
      return "wire " + text("from") + " → " + text("to");
    case "propose_note":
      return "add a note to " + text("card");
    case "propose_ask":
      return "add an ask card " + JSON.stringify(text("name"));
    default:
      // Unreachable through the validated vocabulary; the act's own name is
      // the honest fallback rather than an invented sentence.
      return act.act;
  }
}

/** The acts as the card's short numbered list: one plain line per act. */
export function actLines(acts: readonly CommandAct[]): string[] {
  return acts.map(actLine);
}

/**
 * ONE FAILURE, NAMED EXACTLY. The executor stops at the FIRST failing act and
 * applies nothing after it (commands/execute.ts); a proposal is not a write, so
 * the acts before it are held as ghosts and not applied either. This sentence
 * names the failing act, the app's own reason, and every act's disposition —
 * the report the story's hard constraint asks for.
 */
export function failureReport(
  acts: readonly CommandAct[],
  run: CommandRun,
): string {
  const failed = acts[run.applied] ?? null;
  const reason = run.sentence ?? COMMAND_FAILED_SENTENCE;
  if (failed === null) {
    return reason;
  }
  const before = acts.slice(0, run.applied);
  const after = acts.slice(run.applied + 1);
  const names = (list: readonly CommandAct[]): string =>
    list.map((act) => JSON.stringify(act.act)).join(", ");
  const parts: string[] = [
    "the act " + JSON.stringify(failed.act) + " failed: " + reason,
  ];
  if (before.length === 0) {
    parts.push("Nothing was applied before it.");
  } else if (before.length === 1) {
    parts.push(
      "Nothing was applied: the act before it (" +
        names(before) +
        ") is held as a ghost, not applied.",
    );
  } else {
    parts.push(
      "Nothing was applied: the acts before it (" +
        names(before) +
        ") are held as ghosts, not applied.",
    );
  }
  if (after.length === 0) {
    parts.push("Nothing followed it.");
  } else {
    parts.push(names(after) + " did not run.");
  }
  return parts.join(" ");
}

/**
 * THE ONE CLARIFYING QUESTION IS ANSWERED ONCE. The next interpretation carries
 * the person's instruction, the question the card asked, and the answer, so the
 * model sees the exchange instead of guessing. PROVISIONAL wording.
 */
export function clarifiedInstruction(
  original: string,
  question: string,
  answer: string,
): string {
  return (
    original +
    "\n\nthe card asked: " +
    question +
    "\nthe answer is: " +
    answer
  );
}

/** Turn one interpreter answer into the card's view (PURE). */
export function commandViewOf(
  instruction: string,
  read: InterpreterRead,
): CommandView {
  if (read.kind === "acts") {
    return { kind: "acts", instruction, acts: read.acts };
  }
  if (read.kind === "question") {
    return {
      kind: "question",
      instruction,
      question: read.question,
      answered: false,
    };
  }
  return { kind: "problem", instruction, sentence: read.sentence };
}

/** The composer's disabled state: nothing to read, or already waiting. */
function readDisabled(instruction: string, busy: CommandBusy): boolean {
  return busy !== null || instruction.trim() === "";
}

/** The answer's disabled state: nothing to answer, or already waiting. */
function answerDisabled(answer: string, busy: CommandBusy): boolean {
  return busy !== null || answer.trim() === "";
}

/**
 * THE CARD. Present on every map; CLOSED by default (the closed bar is the
 * whole surface until the person presses it). The open body is the only scroll
 * region; the card never traps focus and never covers the level control.
 */
export function CommandCard({
  level,
  open,
  instruction,
  answer,
  view,
  busy,
  onOpen,
  onClose,
  onInstruction,
  onAnswer,
  onInterpret,
  onAnswerQuestion,
  onAccept,
  onRefuse,
}: CommandCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // ESC CLOSES, and only the person's press opens. The listener is on the
  // window so Esc works wherever focus sits inside the card; it never takes Tab,
  // never calls focus() in a loop, and therefore traps no focus.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  // The instruction field is where the person's press lands: focus it on open,
  // once. A later re-render never steals focus back.
  useEffect(() => {
    if (!open || !commandMapLive(level)) return;
    inputRef.current?.focus();
  }, [open, level]);

  if (!open) {
    return (
      <div className="command-card closed">
        <button
          type="button"
          className="command-card-bar"
          title={COMMAND_INVITATION}
          onClick={onOpen}
        >
          {COMMAND_INVITATION}
        </button>
      </div>
    );
  }

  const waiting = busy !== null;

  return (
    <section
      className="command-card open"
      aria-label="command card"
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="command-card-head">
        <span className="command-card-title">{COMMAND_TITLE}</span>
        <button
          type="button"
          className="command-card-close"
          aria-label="close the command card"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {!commandMapLive(level) ? (
        <div className="command-card-elsewhere">
          {COMMAND_NON_GROUND_SENTENCE}
        </div>
      ) : (
        <>
          <div className="command-card-body">
            {view !== null && view.instruction !== "" && (
              <div className="command-card-last">
                {COMMAND_LAST_LABEL}
                {view.instruction}
              </div>
            )}

            {view?.kind === "acts" && (
              <div className="command-card-script">
                <ol className="command-card-acts">
                  {actLines(view.acts).map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ol>
                <div className="command-card-verbs">
                  <button
                    type="button"
                    className="command-card-accept"
                    title={COMMAND_ONE_PRESS}
                    disabled={waiting}
                    onClick={onAccept}
                  >
                    {COMMAND_ACCEPT_VERB}
                  </button>
                  <button
                    type="button"
                    className="command-card-refuse"
                    disabled={waiting}
                    onClick={onRefuse}
                  >
                    {COMMAND_REFUSE_VERB}
                  </button>
                </div>
              </div>
            )}

            {view?.kind === "question" && (
              <div className="command-card-clarify">
                <div className="command-card-question" role="status">
                  {view.question}
                </div>
                {!view.answered ? (
                  <div className="command-card-answer-row">
                    <input
                      className="command-card-answer"
                      value={answer}
                      placeholder="answer the question"
                      aria-label="answer the clarifying question"
                      disabled={waiting}
                      onChange={(event) => onAnswer(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        onAnswerQuestion();
                      }}
                    />
                    <button
                      type="button"
                      className="command-card-answer-send"
                      disabled={answerDisabled(answer, busy)}
                      onClick={onAnswerQuestion}
                    >
                      {COMMAND_ANSWER_VERB}
                    </button>
                  </div>
                ) : (
                  <div className="command-card-quiet">
                    {COMMAND_SECOND_QUESTION_SENTENCE}
                  </div>
                )}
              </div>
            )}

            {view?.kind === "problem" && (
              <div className="command-card-problem" role="status">
                {view.sentence}
              </div>
            )}

            {view?.kind === "applied" && (
              <div className="command-card-script">
                <ol className="command-card-acts applied">
                  {actLines(view.acts).map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ol>
                <div className="command-card-quiet">
                  {COMMAND_APPLIED_SENTENCE}
                </div>
              </div>
            )}

            {view?.kind === "failed" && (
              <div className="command-card-problem" role="status">
                {view.sentence}
              </div>
            )}

            {view?.kind === "refused" && (
              <div className="command-card-quiet">
                {COMMAND_REFUSED_SENTENCE}
              </div>
            )}

            {busy !== null && (
              <div className="command-card-working" role="status">
                {busy === "reading"
                  ? COMMAND_READING_SENTENCE
                  : COMMAND_APPLYING_SENTENCE}
              </div>
            )}
          </div>

          <div className="command-card-compose">
            <input
              ref={inputRef}
              className="command-card-instruction"
              value={instruction}
              placeholder="say what to change"
              aria-label="the instruction"
              disabled={waiting}
              onChange={(event) => onInstruction(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                onInterpret();
              }}
            />
            <button
              type="button"
              className="command-card-read"
              disabled={readDisabled(instruction, busy)}
              onClick={onInterpret}
            >
              {COMMAND_READ_VERB}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
