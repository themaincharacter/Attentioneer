import type {
  AskDeclaration,
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
    case "reach":
      return block.name + " (" + size + ", a preview)";
    case "instruction":
      return "the instruction (" + size + ")";
    case "bound":
      return "the bound (" + size + ")";
  }
}

/** While the app reads the included previews, nothing can leave yet. */
export const ASK_CONTEXT_READING = "reading the included previews…";

/** The readback's one verb: the exact bytes, message by message (PROVISIONAL). */
export const ASK_BYTES_OPEN = "the exact bytes";
export const ASK_BYTES_CLOSE = "hide the bytes";
export const ASK_BYTES_LABEL = "what leaves, message by message (verbatim)";

/** The follow-up's quiet line: it asked for ONE block and got it. */
export function askReadWords(name: string): string {
  return "it asked for one block by name; the follow-up brought: " + name;
}

/** A READ of a name this view did not carry: one sentence, the answer stands. */
export const ASK_READ_MISSED =
  "it asked for a target this view did not carry; the answer stands.";

/**
 * The response's declared facts, said exactly: the byte size and the decode
 * status the intake declared. Never rounded, never a count of anything else.
 */
export function responseWords(response: AskResponse): string {
  return (
    "size " + response.size + " bytes · " + decodeWords(response.decode)
  );
}
