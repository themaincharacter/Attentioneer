import { useEffect, useState } from "react";
import { assembleCardPacket } from "../turn/packet";
import {
  cardAskContext,
  fetchAskBlock,
  type AskCardFacts,
} from "../turn/context";
import {
  loadProviderConfig,
  providerFrom,
  rememberApiKey,
  rememberedApiKey,
  saveProviderConfig,
} from "../turn/provider";
import { TURN_SENTENCES, type TurnPort } from "../turn/turn";
import type { TurnMessage } from "../turn/protocol";
import { ASK_READ_MISSED } from "./contactRules";
import { PacketSurface } from "./PacketSurface";

/**
 * THE CARD'S ASK PANEL (Epic 15 story 1; story 3b gives it the packet) — the
 * app's first turn of its own, anchored on the ground card it was opened from.
 *
 * WHAT IT SHOWS: the card's NAME (so it is obvious what the question is
 * about), the three provider facts (base URL, model, key), the question box,
 * the DECLARATION of what will go, the verb that opens the exact bytes, send,
 * stop while a turn runs, and the answer below. No counters, no token meters
 * and no cost — one answer is the whole of it.
 *
 * THE SAME PACKET, ONE BLOCK (story 3b). The card's ask used to send the bare
 * hand-written question; the Ask Move had the packet, and one entry point must
 * not be poorer than the other. So this panel assembles the SAME honest packet
 * (turn/packet.ts's assembleCardPacket) around ONE anchored block: the card's
 * coined name, its state sentence when the reading is not current, its bounded
 * reading and note crops, the fixed instruction offering ONE `READ: <name>` of
 * that card, and the bound in words. The card's LINKS are never handed in:
 * a link is wordless wiring, and reading it as context would give it a meaning
 * the epic explicitly defers. The declaration and the exact-bytes readback are
 * the SHARED PacketSurface, the same piece the Ask Move renders — two copies
 * would drift, and then the honesty surface would be worth only the more
 * careful one.
 *
 * ONE RETRIEVAL, NO RECORD. If the model's answer asks for the card's block by
 * its exact heading, the app fetches that block's fuller text ONCE (the pull
 * reader, its existing budget) and sends exactly one follow-up. A name the
 * packet did not carry, or a failed read, gets no follow-up: the first answer
 * stands, and the panel says so in one sentence. A card ask is NOT a Move: it
 * writes no PRISM, no history line and no mirror rewrite — this panel has no
 * record path at all.
 *
 * WHAT IT WRITES: the base URL and the model go into the app's config file
 * (the `config_path` command owns the location) so a provider is configured
 * once. THE KEY IS NOT WRITTEN ANYWHERE: it lives in `turn/provider.ts`'s
 * module memory for this session and vanishes with the process (the OS-keychain
 * story is still to come). Nothing here logs a line, a provider or a key.
 *
 * WHAT IT KEEPS: nothing on the map. The answer is view state of this panel; a
 * close (or a quit) forgets it, and the card is exactly as it was.
 *
 * The port is a PROP (`TurnPort`) rather than an import of the Tauri bridge,
 * in the house idiom: the app passes the real sidecar, and a render test passes
 * a script. The panel never spawns, pipes or kills anything itself.
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
  // The provider fields are seeded from the config file, the key from this
  // session's memory. `loaded` keeps the first render honest: the fields fill
  // when the read answers, without overwriting anything already typed.
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState(rememberedApiKey);
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sentence, setSentence] = useState<string | null>(null);
  const [read, setRead] = useState<string | null>(null);
  const [missed, setMissed] = useState<string | null>(null);
  const [sent, setSent] = useState<readonly TurnMessage[] | null>(null);

  useEffect(() => {
    let alive = true;
    loadProviderConfig().then((stored) => {
      if (!alive) return;
      setBaseUrl((current) => (current === "" ? stored.baseUrl : current));
      setModel((current) => (current === "" ? stored.model : current));
    });
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

  async function send(): Promise<void> {
    if (running) return;
    const asked = question.trim();
    if (asked === "") {
      setSentence(TURN_SENTENCES.noQuestion);
      return;
    }
    const base = baseUrl.trim();
    const chosen = model.trim();
    if (base === "" || chosen === "") {
      setSentence(TURN_SENTENCES.noProvider);
      return;
    }
    // The key is kept for the session and never persisted. A config write that
    // fails is not the turn's failure: the answer can still arrive, and the
    // settings simply do not survive the quit.
    rememberApiKey(apiKey);
    try {
      await saveProviderConfig(base, chosen);
    } catch {
      // Ignored on purpose: the turn does not depend on the file.
    }
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
      providerFrom({ baseUrl: base, model: chosen }, apiKey),
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

      {/* The provider facts. The key's field masks its text and is never
          echoed; the two settings beside it are the config file's. */}
      <div className="ground-ask-provider">
        <label className="ground-ask-field">
          <span>base URL</span>
          <input
            type="text"
            value={baseUrl}
            spellCheck={false}
            autoComplete="off"
            placeholder="https://api.example.com/v1"
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
        <label className="ground-ask-field">
          <span>model</span>
          <input
            type="text"
            value={model}
            spellCheck={false}
            autoComplete="off"
            placeholder="model id"
            onChange={(e) => setModel(e.target.value)}
          />
        </label>
        <label className="ground-ask-field">
          <span>api key</span>
          <input
            type="password"
            value={apiKey}
            spellCheck={false}
            autoComplete="off"
            placeholder="kept in memory for this session"
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
      </div>

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
