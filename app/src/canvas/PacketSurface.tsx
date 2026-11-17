import { useState } from "react";
import type { AskPacketDeclaration } from "../turn/packet";
import type { TurnMessage } from "../turn/protocol";
import {
  ASK_BYTES_CLOSE,
  ASK_BYTES_LABEL,
  ASK_BYTES_OPEN,
  askReadWords,
  packetDeclarationWords,
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
 * (the declaration), then one verb that opens every message verbatim, before
 * or after the send. The follow-up's one line rides after the readback when
 * the model named a block. It shows no counters, no token meters and no sizes
 * anywhere else: this is the only place a size is said.
 *
 * PROVISIONAL (ADR-0003's rendering seam): the layout, the verb's wording and
 * the readback's placement beside the send.
 */
export function PacketSurface({
  declaration = null,
  messages = null,
  read = null,
}: {
  /** The packet's blocks and sizes, or null when there is nothing to declare. */
  declaration?: AskPacketDeclaration | null;
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
