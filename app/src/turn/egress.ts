import { hasProvider, providerFrom, type StoredProvider } from "./provider";
import type { TurnPort } from "./turn";
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
 * PROVISIONAL: the fallback sentences and whether a key is required (story 4's
 * provider rows and keychain decide that; today a configured base URL + model
 * is enough, because a local endpoint may have no key).
 */

/** No provider is configured: the clipboard is the visible fallback. */
export const NO_PROVIDER_SENTENCE =
  "no provider is configured, so the question goes by clipboard — use copy below.";

/** A configured provider whose sidecar will not start: same fallback, said. */
export const SIDECAR_UNAVAILABLE_SENTENCE =
  "the sidecar could not start, so the question goes by clipboard — use copy below.";

/** What the app-sent send reports: an answer, the fallback, or a failed turn. */
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
    }
  | { kind: "unavailable"; sentence: string }
  | {
      kind: "failed";
      sentence: string;
      /** The messages that left before the failure (the readback's bytes). */
      messages: readonly TurnMessage[];
    };

/** The bridges the egress needs, injected (the app passes the real ones). */
export interface PacketSendDeps {
  /** The stored provider row (the key is deliberately NOT stored). */
  loadProvider: () => Promise<StoredProvider>;
  /** The session's key, read at send time (never logged, never written). */
  apiKey: () => string;
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
): Promise<PacketSend> {
  let stored: StoredProvider;
  try {
    stored = await deps.loadProvider();
  } catch {
    return { kind: "unavailable", sentence: NO_PROVIDER_SENTENCE };
  }
  if (!hasProvider(stored)) {
    return { kind: "unavailable", sentence: NO_PROVIDER_SENTENCE };
  }

  const started = await deps.turn.start();
  if (started.kind === "refused") {
    return { kind: "unavailable", sentence: SIDECAR_UNAVAILABLE_SENTENCE };
  }

  const turned = await deps.turn.sendPacket(
    providerFrom(stored, deps.apiKey()),
    packet,
    deps.fetchBlock,
  );
  if (turned.result.kind === "answer") {
    return {
      kind: "answered",
      text: turned.result.text,
      messages: turned.messages,
      read: turned.read,
      missed: turned.missed,
    };
  }
  return {
    kind: "failed",
    sentence: turned.result.sentence,
    messages: turned.messages,
  };
}
