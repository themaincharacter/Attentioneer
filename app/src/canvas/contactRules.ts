import type { AskTransport } from "../contacts/ask";
import type { AskResponse } from "../contacts/ask";
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
 *     the two ways out (copy / hand off), then the response's paste, its
 *     size + decode line, and the keep — a separate act (a Finding).
 *
 * THE WORD IS THE HONESTY. The transports say "copied" and "handed", never
 * "opened": the app knows it handed the address over, not what the OS did
 * with it. The same rule the open-os log keeps. The response's line says the
 * EXACT byte size and the decode status, never a rounded unit.
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

/** The two ways out. */
export const ASK_COPY = "copy the question";
export const ASK_HANDOFF = "hand off the page";

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

/** How each transport reads (copied / handed — never "opened"). */
export const TRANSPORT_WORDS: Readonly<Record<AskTransport, string>> = {
  copy: "copied — the question is on the clipboard",
  handoff: "handed to the OS — the question is on the clipboard",
};

/** The transport's quiet sentence. */
export function transportWord(transport: AskTransport): string {
  return TRANSPORT_WORDS[transport];
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
