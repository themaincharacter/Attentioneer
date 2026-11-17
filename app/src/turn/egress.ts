import { hasProvider, providerFrom, type StoredProvider } from "./provider";
import type { TurnPort } from "./turn";

/**
 * THE APP-SENT ASK'S EGRESS (Epic 15 story 2) — the send the app performs
 * itself, using the SAME envelope as story 1's turn.
 *
 * WHY ONE PROTOCOL: the Ask's packet is the person's authored question plus the
 * CITATIONS of the reaches they included. The clipboard Ask carries those bytes
 * by hand; this route carries exactly those bytes as ONE user message. The
 * packet is passed VERBATIM (see `buildPacketMessages`); nothing here adds a
 * preview, a pointer body or a map file — the app never pre-reads a target to
 * compose a question (ADR-0029 rule 3).
 *
 * THREE OUTCOMES, AND WHY THEY ARE ALL HONEST:
 *   - answered      — one answer came back and the Ask can log its ONE PRISM;
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
  | { kind: "answered"; text: string }
  | { kind: "unavailable"; sentence: string }
  | { kind: "failed"; sentence: string };

/** The bridges the egress needs, injected (the app passes the real ones). */
export interface PacketSendDeps {
  /** The stored provider row (the key is deliberately NOT stored). */
  loadProvider: () => Promise<StoredProvider>;
  /** The session's key, read at send time (never logged, never written). */
  apiKey: () => string;
  /** The turn port: start, send the packet, stop. */
  turn: TurnPort;
}

/**
 * SEND one packet by the app-sent route. A provider is checked BEFORE the
 * sidecar is touched, and the sidecar is started BEFORE a request is written,
 * so "nothing left" is known rather than guessed. The packet is passed to the
 * turn unchanged; the answer is CONTENT handed back to the caller, never
 * written here.
 */
export async function sendPacketApp(
  packet: string,
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

  const result = await deps.turn.sendPacket(
    providerFrom(stored, deps.apiKey()),
    packet,
  );
  if (result.kind === "answer") {
    return { kind: "answered", text: result.text };
  }
  return { kind: "failed", sentence: result.sentence };
}
