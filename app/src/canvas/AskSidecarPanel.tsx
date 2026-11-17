import { useEffect, useState } from "react";
import { assembleCardPacket } from "../turn/packet";
import {
  cardAskContext,
  fetchAskBlock,
  type AskCardFacts,
} from "../turn/context";
import { loadTurnSettings, saveTurnSettings } from "../turn/provider";
import {
  modelsForMove,
  resolveSelection,
  withSelection,
  formatProviderRef,
  PROVIDER_SENTENCES,
  type TurnSettings,
} from "../turn/providers";
import {
  keyExists,
  readSecret,
  secretStatus,
  secretStatusWords,
  type SecretStore,
} from "../lib/secret";
import { TURN_SENTENCES, routeOf, type TurnPort } from "../turn/turn";
import type { TurnMessage } from "../turn/protocol";
import { ASK_READ_MISSED } from "./contactRules";
import { PacketSurface } from "./PacketSurface";
import { ProvidersPanel } from "./ProvidersPanel";

/**
 * THE CARD'S ASK PANEL (Epic 15 story 1; story 3b gives it the packet; story 4
 * gives it providers) — the app's first turn of its own, anchored on the
 * ground card it was opened from.
 *
 * WHAT IT SHOWS: the card's NAME, which provider:model the turn carries (from
 * the rows, never typed here), whether a key is kept for it, WHERE keys live on
 * this machine, the question box, the DECLARATION of what will go, the verb
 * that opens the exact bytes, send, stop while a turn runs, and the answer
 * below. No counters, no token meters and no cost — one answer is the whole
 * of it.
 *
 * WHY THE PROVIDER IS A SELECTION AND NOT THREE FIELDS: the rows own the base
 * URL and the models (turn/providers.ts); the turn carries providerId:modelId
 * and the app re-derives the rest. The person edits rows in ONE panel (the
 * shared ProvidersPanel), so this panel and the Ask Move cannot drift into two
 * ideas of a provider.
 *
 * WHY THE KEY FIELD IS GONE: a key is write-only. It is set in the providers
 * panel, its existence is stated here ("a key is set"), and it is read from the
 * store at SEND time only — never rendered, never kept in state. The status
 * sentence ("keys live in the OS keychain" / "a local file — not the OS
 * keychain") is always visible, because a fallback that is not said is a
 * silent one.
 *
 * THE SAME PACKET, ONE BLOCK (story 3b). This panel assembles the SAME honest
 * packet (turn/packet.ts's assembleCardPacket) around ONE anchored block: the
 * card's coined name, its state sentence when the reading is not current, its
 * bounded reading and note crops, the fixed instruction offering ONE
 * READ: <name> of that card, and the bound in words. The card's LINKS are never
 * handed in: a link is wordless wiring, and reading it as context would give it
 * a meaning the epic explicitly defers.
 *
 * ONE RETRIEVAL, NO RECORD. If the model's answer asks for the card's block by
 * its exact heading, the app fetches that block's fuller text ONCE and sends
 * exactly one follow-up. A name the packet did not carry, or a failed read,
 * gets no follow-up: the first answer stands, and the panel says so in one
 * sentence. A card ask is NOT a Move: it writes no PRISM, no history line and
 * no mirror rewrite.
 *
 * WHAT IT KEEPS: nothing on the map. The answer is view state of this panel; a
 * close (or a quit) forgets it, and the card is exactly as it was.
 *
 * PROVISIONAL (ADR-0003's rendering seam): the panel's shape, the field order,
 * the sentence wording and the declaration/readback placement.
 */
export function AskSidecarPanel({
  card,
  workspacePath,
  turn,
  onClose,
}: {
  /** The anchored card's already-loaded facts (the one block that rides). */
  card: AskCardFacts;
  /** The workspace root, for the ONE follow-up's read (a reader, never a writer). */
  workspacePath: string;
  /** The app's turn port: send the packet, stop the running turn. */
  turn: TurnPort;
  /** Close the panel (view state; nothing is written by closing). */
  onClose: () => void;
}) {
  // The rows and the selection come from the config file; the store's name and
  // whether a key exists come from the key bridge. None of it is a key value.
  const [settings, setSettings] = useState<TurnSettings | null>(null);
  const [store, setStore] = useState<SecretStore | null>(null);
  const [keySet, setKeySet] = useState(false);
  const [providersOpen, setProvidersOpen] = useState(false);
  const [providerNote, setProviderNote] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sentence, setSentence] = useState<string | null>(null);
  const [read, setRead] = useState<string | null>(null);
  const [missed, setMissed] = useState<string | null>(null);
  const [sent, setSent] = useState<readonly TurnMessage[] | null>(null);

  /** Re-read the rows, the store and whether a key is kept (never its value). */
  async function reloadFacts(): Promise<void> {
    const loaded = await loadTurnSettings();
    setSettings(loaded);
    setStore(await secretStatus());
    setKeySet(
      loaded.providerId === "" ? false : await keyExists(loaded.providerId),
    );
  }

  useEffect(() => {
    let alive = true;
    void (async () => {
      const loaded = await loadTurnSettings();
      const status = await secretStatus();
      const kept =
        loaded.providerId === "" ? false : await keyExists(loaded.providerId);
      if (!alive) return;
      setSettings(loaded);
      setStore(status);
      setKeySet(kept);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // The card's context is the app's ALREADY-LOADED state: no read, no reach
  // and no link. The packet is assembled purely from it, so the declaration
  // and the bytes that leave are the same composition.
  const context = cardAskContext(card);
  const packet = assembleCardPacket({
    question,
    card: context.card,
    retrievable: context.retrievable,
  });

  const selectedProvider =
    settings === null
      ? null
      : settings.providers.find(
          (provider) => provider.id === settings.providerId,
        ) ?? null;
  // An ask is text-only today, so the capability filter excludes nothing yet;
  // it is applied anyway, so a later move cannot silently offer a model that
  // cannot do its job.
  const offeredModels =
    selectedProvider === null ? [] : modelsForMove(selectedProvider, {});

  /**
   * Change which provider:model a turn carries. The selection is written at
   * once: the Ask Move reads the same setting, and a choice here that did not
   * persist would make two doors disagree. A failed write is one sentence, and
   * the turn still uses what is on screen.
   */
  async function choose(providerId: string, modelId: string): Promise<void> {
    if (settings === null) return;
    const next = withSelection(settings, providerId, modelId);
    setSettings(next);
    setProviderNote(null);
    setKeySet(providerId === "" ? false : await keyExists(providerId));
    try {
      await saveTurnSettings(next);
    } catch (error) {
      const text = String(error).replace(/\s+/g, " ").trim();
      setProviderNote(
        text === "" ? "the provider choice could not be saved" : text,
      );
    }
  }

  async function send(): Promise<void> {
    if (running) return;
    const asked = question.trim();
    if (asked === "") {
      setSentence(TURN_SENTENCES.noQuestion);
      return;
    }
    // Re-read the rows AT SEND: another surface may have removed the provider
    // since this panel mounted, and a turn must never use a row that is gone.
    // providerId:modelId is the ONLY provider fact it carries; the row supplies
    // the base URL, and a selection that no longer names a row says nothing is
    // configured — never a guess at the nearest endpoint.
    const current = await loadTurnSettings();
    setSettings(current);
    const resolved = resolveSelection(current);
    if (resolved.kind !== "resolved") {
      setSentence(PROVIDER_SENTENCES.nothing);
      return;
    }
    // The key is read NOW, for this provider only, and handed straight to the
    // request line. A CLI takes none, and a local runtime's key is minted by
    // the host per launch. It is never put in state, rendered or logged.
    const apiKey =
      resolved.provider.kind === "http"
        ? await readSecret(resolved.provider.id)
        : "";
    const route = routeOf(resolved.provider, resolved.model, apiKey);

    setSentence(null);
    setAnswer(null);
    setRead(null);
    setMissed(null);
    setSent(null);
    setRunning(true);
    setStopping(false);
    // ONE retrieval: the card's own block, from the source recorded when the
    // context was built. A name the view did not carry answers null, so the
    // first answer stands and nothing outside the packet is ever read.
    const answered = await turn.sendPacket(
      route,
      packet,
      (blockName) =>
        workspacePath === ""
          ? Promise.resolve(null)
          : fetchAskBlock(workspacePath, blockName, context),
    );
    setRunning(false);
    setStopping(false);
    setRead(answered.read);
    setMissed(answered.missed);
    // Every byte that left, including the ONE follow-up when it happened: the
    // readback must be able to show what went out, not only what was composed.
    setSent(answered.messages);
    if (answered.result.kind === "answer") {
      setAnswer(answered.result.text);
    } else {
      setSentence(answered.result.sentence);
    }
  }

  async function stop(): Promise<void> {
    if (!running || stopping) return;
    setStopping(true);
    try {
      await turn.stop();
    } catch {
      // The ask's own line settles the panel; a stop that cannot reach the
      // sidecar leaves the turn to its timeout.
    }
  }

  return (
    <div
      className="ground-ask-panel"
      role="group"
      aria-label="ask about this reference"
    >
      <div className="ground-ask-head">
        <span className="ground-ask-title">ask about “{card.name}”</span>
        <button
          type="button"
          className="ground-ask-close"
          aria-label="close the ask"
          title="close"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {/* THE PROVIDER ROWS' ONE FACT ON THIS PANEL: which provider:model the
          turn carries, from the rows; the verb that opens the shared panel. */}
      <div className="ground-ask-provider">
        <label className="ground-ask-field">
          <span>provider</span>
          <select
            value={settings?.providerId ?? ""}
            aria-label="the provider a turn carries"
            onChange={(e) => {
              const provider = settings?.providers.find(
                (row) => row.id === e.target.value,
              );
              void choose(e.target.value, provider?.models[0]?.id ?? "");
            }}
          >
            <option value="">nothing selected</option>
            {(settings?.providers ?? []).map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ground-ask-field">
          <span>model</span>
          <select
            value={settings?.modelId ?? ""}
            aria-label="the model a turn carries"
            onChange={(e) =>
              void choose(settings?.providerId ?? "", e.target.value)
            }
          >
            <option value="">no model</option>
            {offeredModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </label>
        <div className="ground-ask-keys">
          <span className="ground-ask-ref">
            {formatProviderRef(
              settings?.providerId ?? "",
              settings?.modelId ?? "",
            ) || "nothing configured"}
          </span>
          <span className="ground-ask-key-state">
            {keySet ? "a key is set" : "no key is set"}
          </span>
          <button
            type="button"
            className="ground-ask-open"
            onClick={() => setProvidersOpen((open) => !open)}
          >
            {providersOpen ? "hide providers" : "providers…"}
          </button>
        </div>
        {/* THE STATUS SENTENCE, always visible: which store keeps keys here. */}
        <div className="ground-ask-key-store" role="status">
          {store === null ? "asking where keys live…" : secretStatusWords(store)}
        </div>
        {providerNote !== null && (
          <div className="ground-ask-problem" role="status">
            {providerNote}
          </div>
        )}
      </div>

      {providersOpen && (
        <ProvidersPanel
          onClose={() => setProvidersOpen(false)}
          onChanged={() => void reloadFacts()}
        />
      )}

      <textarea
        className="ground-ask-question"
        value={question}
        autoFocus
        placeholder="your question"
        onChange={(e) => setQuestion(e.target.value)}
      />

      {/* THE DECLARATION AND THE READBACK, the shared piece: before the send
          every block with its exact size, the total, and the exact bytes; after
          it, the messages that actually left (the follow-up included). The
          card's crops are already loaded, so the declaration is ready on the
          first render — nothing is read to declare it. */}
      {sent === null ? (
        <PacketSurface
          declaration={packet.declaration}
          messages={packet.messages}
        />
      ) : (
        <PacketSurface messages={sent} read={read} />
      )}

      <div className="ground-ask-actions">
        <button
          type="button"
          className="ground-ask-send"
          disabled={running}
          onClick={() => void send()}
        >
          send
        </button>
        {running && (
          <button
            type="button"
            className="ground-ask-stop"
            disabled={stopping}
            onClick={() => void stop()}
          >
            stop
          </button>
        )}
      </div>

      {answer !== null && <div className="ground-ask-answer">{answer}</div>}
      {missed !== null && (
        <div className="ground-ask-problem" role="status">
          {ASK_READ_MISSED}
        </div>
      )}
      {sentence !== null && (
        <div className="ground-ask-problem" role="status">
          {sentence}
        </div>
      )}
    </div>
  );
}
