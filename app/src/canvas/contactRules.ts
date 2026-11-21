import type {
  AskDeclaration,
  AskEnding,
  AskResponse,
  AskTransport,
} from "../contacts/ask";
import type {
  AskPacketDeclaration,
  AskPacketDeclarationLine,
} from "../turn/packet";
import { decodeWords } from "./prismRules";

/**
 * THE CONTACT PANELS' QUIET WORDS (Epic 12 story 3) — pure strings and one
 * fact line, kept apart from the two components so bun asserts the wording
 * without a DOM.
 *
 * Two surfaces:
 *   - MAKE's panel: the artifact's path (the person names it), the text to
 *     write, and one quiet "make". No gate, no approval, no proposal: the
 *     person's press is the whole of it.
 *   - ASK's panel: the question, the reaches that ride (the inclusion set),
 *     the DECLARATION of what will go (the citations and their exact sizes,
 *     shown before anything leaves), the app's send, the stated clipboard
 *     fallback, then the response (in place by itself, or pasted), its
 *     size + decode line, and the keep — a separate act (a Finding).
 *
 * THE WORD IS THE HONESTY. The transports say "sent", "copied" and "handed",
 * never "opened": the app knows it handed the address over, not what the OS
 * did with it. The same rule the open-os log keeps. The response's line says
 * the EXACT byte size and the decode status, never a rounded unit.
 *
 * Provisional: every sentence here (the panel's look is provisional too).
 */

/** The Make panel's header. */
export const MAKE_TITLE = "make an artifact";

/** The artifact's named path (workspace-relative, the person's own word). */
export const MAKE_PATH_LABEL = "the artifact's path (inside the workspace)";
export const MAKE_PATH_PLACEHOLDER = "notes/the-artifact.md";

/** The text the person authored — written verbatim. */
export const MAKE_TEXT_LABEL = "the artifact's text (yours, verbatim)";
export const MAKE_TEXT_PLACEHOLDER = "…";

/** The Move's one button. */
export const MAKE_BUTTON = "make";

/** Nothing is named: the button is dead, and Enter says why once. */
export const MAKE_NEEDS_NAME = "name the artifact first";

/** The Move could not be made (the flow's own reason rides instead). */
export const MAKE_REFUSED = "nothing was made";

/** The artifact was made and its pointer minted. */
export const MAKE_DONE = "made";

/** The Ask panel's header. */
export const ASK_TITLE = "ask — the question out, the response back";

/** The person's authored question. */
export const ASK_QUESTION_LABEL = "your question (yours, verbatim)";
export const ASK_QUESTION_PLACEHOLDER = "ask…";

/** The reach the question rides, or none. */
export const ASK_RIDES = "rides: ";
export const ASK_NO_REACH = "no reach";

/** The inclusion set: the reaches whose citations ride in the packet. */
export const ASK_INCLUDED_LABEL = "included reaches";
export const ASK_NOTHING_INCLUDED = "no reach rides along";

/**
 * The ways out, in the panel's order: the app carries the packet itself; the
 * clipboard and the OS handoff are the STATED fallback (never silent).
 */
export const ASK_SEND = "send (the app carries it)";
export const ASK_STOP = "stop";
export const ASK_COPY = "copy the question";
export const ASK_HANDOFF = "hand off the page";

/** The line that names what will go, before anything leaves (PROVISIONAL). */
export const ASK_DECLARATION_LABEL = "will go: ";

/** The response's paste. */
export const ASK_PASTE_LABEL = "the response (paste it)";
export const ASK_PASTE_PLACEHOLDER = "paste what came back…";

/** An attached file that came with the response (workspace-relative path). */
export const ASK_ATTACH_LABEL = "an attached file (workspace path, optional)";
export const ASK_ATTACH_PLACEHOLDER = "notes/attached.md";

/** Complete the Move: log the response (or close it unanswered). */
export const ASK_LOG_IT = "log it";

/** Show the ONE PRISM this Ask appended (record != visible: on demand). */
export const ASK_SHOW_LOG = "the log";
export const ASK_NO_RESPONSE = "nothing came back";

/** The keep — the FINDING move, separate from the log. */
export const ASK_KEEP = "keep it (to this word's memory)";
export const ASK_KEPT = "kept to memory";
export const ASK_KEEP_FAILED = "not kept — this word has no memory to write";

/** A question with no prose never leaves. */
export const ASK_NEEDS_QUESTION = "ask needs a question";

/** The send threw: the question's fate is unknown, and the panel says so. */
export const ASK_SEND_FAILED = "the question did not leave";

/** The panel's note when the Move is waiting on a write. */
export const ASK_BUSY = "…";

/** How each transport reads (sent / copied / handed — never "opened"). */
export const TRANSPORT_WORDS: Readonly<Record<AskTransport, string>> = {
  app: "sent — the app carried the packet and the answer came back here",
  copy: "copied — the question is on the clipboard",
  handoff: "handed to the OS — the question is on the clipboard",
};

/** The transport's quiet sentence. */
export function transportWord(transport: AskTransport): string {
  return TRANSPORT_WORDS[transport];
}

/**
 * THE DECLARATION, in one line: the question's exact size, each included
 * citation with its own size, and the packet's total. Derived from the same
 * bytes the send carries; the app reads no target to write it (PROVISIONAL
 * wording).
 */
export function declarationWords(declaration: AskDeclaration): string {
  const parts: string[] = [
    "your question (" + declaration.questionSize + " bytes)",
  ];
  if (declaration.citations.length === 0) {
    parts.push("no citation");
  } else {
    parts.push(
      "the citations " +
        declaration.citations
          .map(
            (citation) =>
              citation.form +
              " " +
              citation.value +
              " (" +
              citation.size +
              " bytes)",
          )
          .join(", "),
    );
  }
  return (
    ASK_DECLARATION_LABEL +
    parts.join(" \u00b7 ") +
    " \u00b7 " +
    declaration.packetSize +
    " bytes in all"
  );
}

/**
 * THE APP-SENT PACKET'S DECLARATION (Epic 15 story 3): every block and its
 * exact byte size, then the whole packet's total. It is derived from the same
 * block bytes the send carries, and it is the ONLY place a size appears — the
 * bytes that go to the model carry no counts and no size figures.
 */
export function packetDeclarationWords(
  declaration: AskPacketDeclaration,
): string {
  const parts = declaration.blocks.map(
    (block) => packetBlockWords(block),
  );
  return (
    ASK_DECLARATION_LABEL +
    parts.join(" \u00b7 ") +
    " \u00b7 " +
    declaration.total +
    " bytes in all"
  );
}

/** One block, said by its kind (the card's name is quoted; a reach by citation). */
function packetBlockWords(block: AskPacketDeclarationLine): string {
  const size = block.size + " bytes";
  switch (block.kind) {
    case "question":
      return "your question (" + size + ")";
    case "card":
      return "the card \u201c" + block.name + "\u201d (" + size + ")";
    case "thread":
      // The conversation's block: named plainly, sized like every other block.
      return "the conversation (" + size + ")";
    case "page":
      // STORY 16.26 — the page's read, sized like any other block: the numbers
      // here are the declaration's whole point.
      return block.name + " (" + size + ")";
    case "reach":
      return block.name + " (" + size + ", a preview)";
    case "instruction":
      return "the instruction (" + size + ")";
    case "bound":
      return "the bound (" + size + ")";
  }
}

/**
 * STORY 16.26 — THE PAGE THAT WILL BE OPENED. A page card keeps no transcript,
 * so the page is read when the question is sent. The declaration says that
 * BEFORE the press, in one sentence naming the address: the person is told a
 * read will happen and that the block's exact size appears beside these once
 * it answers. No size is promised before it exists, and no counter is shown.
 *
 * PURE, so bun pins the wording without a window. PROVISIONAL wording.
 */
export function askLivePageWords(url: string): string {
  return (
    "the page at " +
    url +
    " will be read when you send, and its block declared beside these with the bytes that come back."
  );
}

/** While the app reads the included previews, nothing can leave yet. */
export const ASK_CONTEXT_READING = "reading the included previews…";

/** The readback's one verb: the exact bytes, message by message (PROVISIONAL). */
export const ASK_BYTES_OPEN = "the exact bytes";
export const ASK_BYTES_CLOSE = "hide the bytes";
export const ASK_BYTES_LABEL = "what leaves, message by message (verbatim)";

/**
 * STORY 16.27 — THE CARD'S ONE QUIET DISCLOSURE (PROVISIONAL wording).
 *
 * The declaration — every block with its size, both calls, the live page line
 * and the exact-bytes reader — is not the card's face. It is what the machinery
 * knows, one verb away, and the verb is the ONLY way in: a send never opens it.
 * The face therefore states no size at all; the numbers live where the person
 * asked for them.
 *
 * Two wordings for the SAME disclosure, because the truth changes with the
 * send: before it, these are the bytes that WILL go; after it, the bytes that
 * DID. The open state is a native disclosure (the summary is the verb), so the
 * text never has to say "press to open" and no state is invented here.
 */
export const ASK_DECLARATION_VERB = "what will be sent";
export const ASK_DECLARATION_VERB_SENT = "what was sent";

/**
 * STORY 16.27 — THE FOOTER'S ONE OVERFLOW VERB (PROVISIONAL wording). The
 * primary action stays in the footer (send, or stop while a turn runs); every
 * other verb the card owns lives one press further in, so the face does not
 * read as a row of buttons. The three are the SAME verbs as before: a fork, a
 * remove, a close.
 */
export const ASK_OVERFLOW_VERB = "more";
export const ASK_OVERFLOW_FORK = "fork";
export const ASK_OVERFLOW_REMOVE = "remove";
export const ASK_OVERFLOW_CLOSE = "close";

/**
 * STORY 17.13 — THE DECLARATION NAMES BOTH CALLS (ADR-0037 decision 1: "a
 * turn's declaration names both"). An ask now spends two models — the task
 * answers, the manager distils — so the surface in front of the person says
 * which model does which, and says the distil step is CONDITIONAL: it runs only
 * after a completed answer. It states ROLES and CONDITIONALITY, never a count,
 * a cost or a time.
 *
 * THREE truths, three wordings, because the app can be in three states and one
 * sentence cannot be true in all of them:
 *   - two models: the task row/model, the manager row/model, and the condition;
 *   - ONE model both: a single line, no invented distinction between roles;
 *   - no manager: the card is made by a RULE (17.11's path), because that is
 *     what will happen — a declaration never promises a second call that won't
 *     be made.
 *
 * PURE: the facts are two named rows/models (or one, or none). No settings read,
 * no I/O, no clock — so bun asserts every wording without a DOM.
 *
 * PROVISIONAL: the wording of every line and where the calls section sits in
 * the declaration.
 */

/** One model a call is made to, named the way its settings row shows it. */
export interface AskModelName {
  /** The provider row's display name (the person's own label). */
  row: string;
  /** The model row's display name. */
  model: string;
}

/** What a pre-send declaration can say about the ask's calls. */
export interface AskCallsFacts {
  /** The task model: always there when there is anything to declare. */
  task: AskModelName;
  /** The manager model, or null when no manager is configured at all. */
  manager: AskModelName | null;
  /**
   * STORY 16.29 — THE EFFORT THIS ASK SENDS, or null/absent for default. It is
   * the CARD's own pick (the person's, per ask), not a Settings value, which is
   * why it is handed in beside the two calls rather than read from the row. The
   * declaration names it on the TASK line only: the curator distils, it does
   * not reason, and a declaration that implied an effort on the distil call
   * would describe a request the app never makes.
   */
  effort?: string | null;
}

/** The parts of the calls section (PROVISIONAL wording). */
export const ASK_CALLS_TASK = "the task model answers: ";
export const ASK_CALLS_MANAGER =
  "then the manager model distils the reply into a card: ";
export const ASK_CALLS_CONDITION =
  "the distil step runs only if the answer completes";
export const ASK_CALLS_SAME = "one model does both: ";
export const ASK_CALLS_NO_MANAGER =
  "no manager model is configured, so the card will be made by a rule instead";
/**
 * STORY 16.29 — THE EFFORT CLAUSE. It rides the TASK line, because that is the
 * only call it reaches. With two models the sentence reads "... at <effort>";
 * with ONE model doing both, the same line also says the distil call sends
 * none, so the declaration never implies an effort the app does not send.
 */
export const ASK_CALLS_EFFORT = " at ";
export const ASK_CALLS_EFFORT_CURATOR =
  " for the answer; the distil call sends no effort";

/**
 * STORY 22.4 — THE SESSION CARD'S RUN DECLARATION (PROVISIONAL wording). The
 * declaration stands BEFORE the run (as an ask's does): the task model answers,
 * then the manager model distils the result into a card. The distil is
 * automatic now, so no condition line is said — a partial's words are read too.
 * The manager line, the same-model line and the no-manager line are the ask's
 * own constants — the distil step is the same step, one card family over, and
 * two wordings for one fact is how they drift.
 */

/** A row and model as one name; a row that already says the model says it once. */
function askModelWords(name: AskModelName): string {
  const row = name.row.trim();
  const model = name.model.trim();
  if (row === "" && model === "") return "";
  if (row === "" || row === model) return model === "" ? row : model;
  if (model === "") return row;
  return row + " / " + model;
}

/**
 * THE CALLS SECTION, line by line (story 17.13). One array so the surface
 * draws one quiet line per fact and the test reads the same values the person
 * does. Same model both roles collapses to ONE line: the app makes two calls
 * but there is no second model to name, and inventing a difference would be
 * the quiet cost this app refuses.
 */
export function askCallsWords(calls: AskCallsFacts): string[] {
  const task = askModelWords(calls.task);
  // STORY 16.29 — "default" is not an effort to name: it is the choice that
  // sends no field, so the calls section says nothing about it.
  const effort = calls.effort?.trim() ?? "";
  const named = effort === "" || effort === "default" ? "" : effort;
  const taskLine = ASK_CALLS_TASK + task + (named === "" ? "" : ASK_CALLS_EFFORT + named);
  if (calls.manager === null) {
    return [taskLine, ASK_CALLS_NO_MANAGER];
  }
  const manager = askModelWords(calls.manager);
  if (manager === task) {
    return [
      ASK_CALLS_SAME +
        task +
        (named === "" ? "" : ASK_CALLS_EFFORT + named + ASK_CALLS_EFFORT_CURATOR),
    ];
  }
  return [
    taskLine,
    ASK_CALLS_MANAGER + manager,
    ASK_CALLS_CONDITION,
  ];
}

/**
 * THE SESSION CARD'S ONE DECLARATION BEFORE A RUN (story 22.4): the row that
 * will answer, then the model that will distil its result — or, when no turn
 * provider resolves at all, the honest fact that the card will be made by a
 * rule (there is no second call to promise). PURE, so the sentence the person
 * reads is the one the test asserts.
 */
export function sessionDistilWords(facts: {
  /** The run's own tool row, as the card shows it. */
  task: AskModelName;
  /** The manager model, or null when no turn provider resolves at all. */
  manager: AskModelName | null;
}): string[] {
  const task = askModelWords(facts.task);
  if (facts.manager === null) {
    return [ASK_CALLS_TASK + task, ASK_CALLS_NO_MANAGER];
  }
  const manager = askModelWords(facts.manager);
  if (manager === task) return [ASK_CALLS_SAME + task];
  return [ASK_CALLS_TASK + task, ASK_CALLS_MANAGER + manager];
}

/**
 * STORY 22.6 — THE SESSION CARD'S ONE RESULT VERB (PROVISIONAL wording). One
 * press tries the curator and falls back to 18.4's rule copy, so the old pair
 * of words is gone: this does not say "distil" or "result", it says what the
 * person gets — a card.
 */
export const SESSION_RESULT_KEEP_VERB = "keep this as a card";

/**
 * THE PARTIAL'S ONE QUIET LINE (Epic 15 story 7b). A stopped, broken or
 * timed-out turn keeps the words it showed, and says in one sentence that they
 * were NOT recorded as an answer. A partial is never dressed as complete, and
 * the record never gets a size from it.
 */
export function askPartialWords(ending: AskEnding): string {
  switch (ending) {
    case "stopped":
      return "stopped mid-answer — this was not recorded as an answer.";
    case "timed-out":
      return "the provider did not answer in time — this was not recorded as an answer.";
    case "failed":
      return "the turn broke off — this was not recorded as an answer.";
    case "answered":
      return "";
  }
}

/** The follow-up's quiet line: it asked for ONE block and got it. */
export function askReadWords(name: string): string {
  return "it asked for one block by name; the follow-up brought: " + name;
}

/**
 * STORY 16.27 — THE RETRIEVAL OFFER, AS A VERB. After a turn whose follow-up
 * fetched a block, the card used to show the whole askReadWords sentence on
 * its face; the sentence stays (inside the declaration, where the readback
 * lives) and the face offers the act instead. The name is the follow-up's own
 * block, never a count and never an internal key. PROVISIONAL wording.
 */
export function askReadMoreWords(name: string): string {
  return "read more of " + name;
}

/** A READ of a name this view did not carry: one sentence, the answer stands. */
export const ASK_READ_MISSED =
  "it asked for a target this view did not carry; the answer stands.";

/**
 * STORY 16.28 — THE QUIET WORKING LINE. The user, live: "There is no loading
 * indicator to let the user know that the LLM is thinking or whatever." There
 * are TWO waits in one ask — the task call before the first streamed word, and
 * the curator call after the last one — and in both the card used to look like
 * it did nothing. So the thread carries ONE quiet line while work is happening:
 * this line while the task call runs, the next while the curator distils, and
 * nothing at all when idle. Three states, one line each; the wording is
 * PROVISIONAL, the states are not.
 *
 * IT NEVER LIES ABOUT PROGRESS. The line says THAT work is happening, nothing
 * about how much: no percentage, no elapsed seconds, no token count, no step
 * number, no digit of any kind (a test pins that). The streamed text is the
 * real indicator, and it supersedes this line the instant a part arrives.
 */
export const ASK_WORKING_TASK = "the model is working";
export const ASK_WORKING_CURATOR = "distilling the answer";

/** The two kinds of work the line can name; idle is the absence of both. */
export type AskWorking = "task" | "curator";

/**
 * WHERE THE TURN HAS GOT TO, as the card is told it: the task call, the
 * curator call, or nothing running. The card sets `task` itself at the send
 * (the press is its own fact) and the layer reports the curator's start and
 * end, because only the layer makes that call.
 */
export type AskWorkPhase = AskWorking | "idle";

/** The line for a kind of work (PURE, PROVISIONAL wording, never a number). */
export function askWorkingWords(working: AskWorking): string {
  return working === "curator" ? ASK_WORKING_CURATOR : ASK_WORKING_TASK;
}

/**
 * The response's declared facts, said exactly: the byte size and the decode
 * status the intake declared. Never rounded, never a count of anything else.
 */
export function responseWords(response: AskResponse): string {
  return (
    "size " + response.size + " bytes · " + decodeWords(response.decode)
  );
}
