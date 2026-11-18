import { resolveSelection, type TurnSettings } from "./providers";
import { routeOf, type TurnPort } from "./turn";
import type { ProposalRead } from "./turn";
import type { AskPacket } from "./packet";
import type { TurnMessage } from "./protocol";

/**
 * THE APP-SENT ASK'S EGRESS (Epic 15 story 2) — the send the app performs
 * itself, using the SAME envelope as story 1's turn.
 *
 * WHY ONE PROTOCOL: the Ask's packet is the bounded view the app assembled
 * around the anchored card (turn/packet.ts). The clipboard Ask carries the old
 * citations-only bytes by hand; this route carries the packet's ONE message
 * VERBATIM, and at most ONE follow-up for a block the model named with the
 * packet's READ form. Nothing here re-reads, re-composes or trims: the bytes
 * the person saw in the readback are the bytes that leave.
 *
 * THREE OUTCOMES, AND WHY THEY ARE ALL HONEST:
 *   - answered      — one answer came back (the packet's, or the follow-up's
 *                     when the model named one block) and the Ask can log its
 *                     ONE PRISM;
 *   - unavailable   — nothing can leave (no provider, or the sidecar cannot
 *                     start). This is the STATED FALLBACK, not an Ask failure:
 *                     no record is written and the person may use the clipboard;
 *   - failed        — the attempt left but produced no answer (a provider
 *                     error, a stop, a timeout). One sentence, no record here:
 *                     the panel holds the question in flight, and the person
 *                     either pastes a clipboard answer or ends it — exactly ONE
 *                     PRISM either way, never two.
 *
 * WHAT IS NEVER WRITTEN OR LOGGED: the key (it rides one request line and
 * nothing else), the question, and the answer. This module has no fs import and
 * no write path at all.
 *
 * PROVISIONAL: the fallback sentences and whether a key is required. Story 4
 * settles the provider's identity as providerId:modelId; the key is still
 * optional here, because a local endpoint on loopback may legitimately have
 * none, and a wrong key fails one turn with one sentence.
 */

/**
 * Nothing resolves (no rows, or the selected row/model is gone): the clipboard
 * is the visible fallback. A removed provider clears the selection, so a turn
 * that named it lands here and SAYS nothing is configured rather than reaching
 * for a base URL nobody has any more.
 */
export const NO_PROVIDER_SENTENCE =
  "no provider is configured, so the question goes by clipboard — use copy below.";

/** A configured provider whose sidecar will not start: same fallback, said. */
export const SIDECAR_UNAVAILABLE_SENTENCE =
  "the sidecar could not start, so the question goes by clipboard — use copy below.";

/**
 * What the app-sent send reports: an answer, the fallback, or an ending that
 * is NOT an answer (story 7b). The ending is typed because the record is
 * formed from it: a stop, a break and the turn's own budget are the existing
 * no-response, even when words arrived. The partial is a view of those words,
 * never a response size.
 */
export type PacketSend =
  | {
      kind: "answered";
      text: string;
      /** Every message that left, verbatim (the readback, follow-up included). */
      messages: readonly TurnMessage[];
      /** The block the one follow-up fetched, or null. */
      read: string | null;
      /** A name the model asked for that the packet did not carry, or null. */
      missed: string | null;
      /** The proposal block the answer carried, read after it completed. */
      ghost: ProposalRead;
    }
  | { kind: "unavailable"; sentence: string }
  | {
      /** The person pressed stop: what arrived is kept, marked as a partial. */
      kind: "stopped";
      /** The words that arrived before the stop, or null for none. */
      partial: string | null;
      /** The messages that left before the stop (the readback's bytes). */
      messages: readonly TurnMessage[];
    }
  | {
      kind: "failed";
      sentence: string;
      /** The words that arrived before the break, when there were any. */
      partial?: string;
      /** The messages that left before the failure (the readback's bytes). */
      messages: readonly TurnMessage[];
    }
  | {
      kind: "timed-out";
      sentence: string;
      /** The words that arrived before the budget ran out, when any did. */
      partial?: string;
      /** The messages that left before the budget ran out. */
      messages: readonly TurnMessage[];
    };

/** The bridges the egress needs, injected (the app passes the real ones). */
export interface PacketSendDeps {
  /** The provider rows and the selection (the key is deliberately NOT here). */
  loadSettings: () => Promise<TurnSettings>;
  /** The key for one provider, read at send time (never logged, never shown). */
  apiKey: (providerId: string) => Promise<string>;
  /** The turn port: start, send the packet, stop. */
  turn: TurnPort;
  /** Read ONE sent block's fuller text (the pull reader); null for none. */
  fetchBlock: (name: string) => Promise<string | null>;
}

/**
 * SEND one packet by the app-sent route. A provider is checked BEFORE the
 * sidecar is touched, and the sidecar is started BEFORE a request is written,
 * so "nothing left" is known rather than guessed. The packet is passed to the
 * turn unchanged; the answer is CONTENT handed back to the caller, never
 * written here.
 */
export async function sendPacketApp(
  packet: AskPacket,
  deps: PacketSendDeps,
  onPart?: (text: string) => void,
): Promise<PacketSend> {
  let settings: TurnSettings;
  try {
    settings = await deps.loadSettings();
  } catch {
    return { kind: "unavailable", sentence: NO_PROVIDER_SENTENCE };
  }
  // ONLY providerId:modelId decides whether a turn can leave: the row supplies
  // the base URL and the model id, and a selection that no longer names a row
  // is the stated fallback, not a guess at the nearest endpoint.
  const resolved = resolveSelection(settings);
  if (resolved.kind !== "resolved") {
    return { kind: "unavailable", sentence: NO_PROVIDER_SENTENCE };
  }

  // The route is read from the row ONCE here; the port dispatches on it. The
  // key is read now, for this provider only, and an endpoint route carries it
  // — a CLI route has no use for one (and must not be handed one).
  // The endpoint is the only kind whose key lives in the store. A CLI takes
  // none, and a local runtime's key is minted by the host for that launch.
  const apiKey =
    resolved.provider.kind === "http"
      ? await deps.apiKey(resolved.provider.id)
      : "";
  const route = routeOf(resolved.provider, resolved.model, apiKey);
  const started = await deps.turn.start(route);
  if (started.kind === "refused") {
    // A route that cannot start is the same visible fallback: nothing left.
    return {
      kind: "unavailable",
      sentence:
        route.kind === "cli" || route.kind === "local"
          ? started.sentence
          : SIDECAR_UNAVAILABLE_SENTENCE,
    };
  }

  // The SAME options a panel streams with: the parts are a view of the text
  // the result settles with, so the ending and the screen can never disagree.
  const turned = await deps.turn.sendPacket(
    route,
    packet,
    deps.fetchBlock,
    onPart === undefined ? undefined : { onPart },
  );
  if (turned.result.kind === "answer") {
    return {
      kind: "answered",
      text: turned.result.text,
      messages: turned.messages,
      read: turned.read,
      missed: turned.missed,
      ghost: turned.proposal ?? { kind: "none" },
    };
  }
  // THE ENDING, TYPED (story 7b): a stopped turn is its own kind, the budget
  // is its own, and a provider error is the third. Each carries the partial it
  // kept, so the panel can hold the words while the record says no answer.
  const partial =
    turned.result.partial === undefined ? {} : { partial: turned.result.partial };
  if (turned.result.kind === "cancelled") {
    return {
      kind: "stopped",
      partial: turned.result.partial ?? null,
      messages: turned.messages,
    };
  }
  if (turned.result.kind === "timeout") {
    return {
      kind: "timed-out",
      sentence: turned.result.sentence,
      messages: turned.messages,
      ...partial,
    };
  }
  return {
    kind: "failed",
    sentence: turned.result.sentence,
    messages: turned.messages,
    ...partial,
  };
}
