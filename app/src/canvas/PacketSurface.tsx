import { useState } from "react";
import type { AskPacketDeclaration } from "../turn/packet";
import type { TurnMessage } from "../turn/protocol";
import {
  ASK_BYTES_CLOSE,
  ASK_BYTES_LABEL,
  ASK_BYTES_OPEN,
  askCallsWords,
  askLivePageWords,
  askReadWords,
  packetDeclarationWords,
  type AskCallsFacts,
} from "./contactRules";

/**
 * THE DECLARATION AND THE READBACK (Epic 15 story 3b) — ONE piece, used by
 * both entry points to the app-sent packet.
 *
 * WHY ONE PIECE: the Ask Move and the ground card's ask… must show the SAME
 * pre-send facts and open the SAME exact bytes. Two copies would drift: one
 * panel could quietly declare a block it does not send, or send a byte it
 * never declared, and the honesty surface would be worth only the more
 * careful copy. So the line and the verb live here, derived from the
 * declaration the packet itself returned, and both panels render this.
 *
 * WHAT IT SHOWS: every block with its exact byte size and the packet's total
 * (the declaration), STORY 17.13's calls section when the caller knows the two
 * models (who answers, who distils, and that the distil step waits for a
 * completed answer), then one verb that opens every message verbatim, before
 * or after the send. The follow-up's one line rides after the readback when
 * the model named a block. It shows no counters, no token meters and no sizes
 * anywhere else: this is the only place a size is said.
 *
 * STORY 16.26 adds ONE pre-send line: a page card keeps no transcript, so the
 * page is read when the question is sent, and the declaration says that before
 * the press. Its block's size appears in the readback, beside the exact bytes
 * that left, because the block does not exist until the page has answered.
 *
 * PROVISIONAL (ADR-0003's rendering seam): the layout, the verb's wording and
 * the readback's placement beside the send.
 */
export function PacketSurface({
  declaration = null,
  livePages = null,
  calls = null,
  effort = null,
  messages = null,
  read = null,
}: {
  /** The packet's blocks and sizes, or null when there is nothing to declare. */
  declaration?: AskPacketDeclaration | null;
  /**
   * STORY 16.26 — THE PAGES THE QUESTION WILL OPEN WHEN IT IS SENT. Their
   * blocks exist only once the sidecar answers, so the PRE-SEND declaration
   * says the read will happen (naming the address); the sizes appear in the
   * readback, beside the bytes that actually left. Null says nothing.
   */
  livePages?: readonly string[] | null;
  /**
   * STORY 17.13 — THE TWO CALLS a send will make, when the caller knows them:
   * the task model and the manager model (or the same one, or none). Null
   * means the caller cannot say, and the surface says nothing new.
   */
  calls?: AskCallsFacts | null;
  /**
   * STORY 16.29 — THE EFFORT THIS ASK WILL SEND, or null for default. It is
   * handed beside the calls rather than merged into them by the caller, so the
   * calls section stays the ONE place that decides how the effort is worded,
   * and the manager line never picks it up (the curator sends none).
   */
  effort?: string | null;
  /** Every message that would leave (or did), verbatim; null hides the verb. */
  messages?: readonly TurnMessage[] | null;
  /** The one block a follow-up fetched, or null when none happened. */
  read?: string | null;
}) {
  const [showBytes, setShowBytes] = useState(false);
  return (
    <>
      {declaration !== null && (
        <div className="ask-declaration">
          {packetDeclarationWords(declaration)}
          {/* STORY 17.13 — THE CALLS, beside the blocks: one line per fact,
              the same words the pure rules produced. The blocks above are
              byte-identical to before this section arrived. */}
          {calls !== null &&
            askCallsWords({ ...calls, effort }).map((line, index) => (
              <div className="ask-calls-line" key={index}>
                {line}
              </div>
            ))}
          {/* STORY 16.26 — the page the send will open, said before the press.
              One line per page, and no size claimed: the size is the readback's
              fact once the page has answered. */}
          {livePages !== null &&
            livePages.map((url, index) => (
              <div className="ask-live-page" key={index}>
                {askLivePageWords(url)}
              </div>
            ))}
        </div>
      )}
      {messages !== null && (
        <>
          <button
            type="button"
            className="ask-bytes-open"
            title={ASK_BYTES_OPEN}
            onClick={(e) => {
              e.stopPropagation();
              setShowBytes((shown) => !shown);
            }}
          >
            {showBytes ? ASK_BYTES_CLOSE : ASK_BYTES_OPEN}
          </button>
          {showBytes && <AskBytes messages={messages} />}
        </>
      )}
      {read !== null && <div className="ask-read">{askReadWords(read)}</div>}
    </>
  );
}

/** ONE message, verbatim: its role as a label, its bytes as they left. */
function AskMessage({ message }: { message: TurnMessage }) {
  return (
    <div className="ask-message" data-role={message.role}>
      <div className="ask-message-role">{message.role}</div>
      <pre className="ask-message-text">{message.content}</pre>
    </div>
  );
}

/** The readback's block: every message, verbatim, in the order it left. */
function AskBytes({ messages }: { messages: readonly TurnMessage[] }) {
  return (
    <div className="ask-bytes" role="group" aria-label={ASK_BYTES_LABEL}>
      {messages.map((message, index) => (
        <AskMessage key={index} message={message} />
      ))}
    </div>
  );
}
