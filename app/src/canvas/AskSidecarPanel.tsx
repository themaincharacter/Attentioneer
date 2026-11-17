import { useEffect, useState } from "react";
import {
  loadProviderConfig,
  providerFrom,
  rememberApiKey,
  rememberedApiKey,
  saveProviderConfig,
} from "../turn/provider";
import {
  TURN_SENTENCES,
  type TurnPort,
  type TurnResult,
} from "../turn/turn";

/**
 * THE ASK PANEL (Epic 15 story 1) — the first turn the app makes by itself,
 * anchored on the card it was opened from.
 *
 * WHAT IT SHOWS: the card's NAME (so it is obvious what the question is
 * about), the three provider facts (base URL, model, key), the question box,
 * send, stop while a turn runs, and the answer below. Nothing else comes from
 * the map: the request carries the question and a fixed instruction, and story
 * 3 is what adds a packet. It shows no counters, no token meters and no cost —
 * one answer is the whole of it.
 *
 * WHAT IT WRITES: the base URL and the model go into the app's config file
 * (the `config_path` command owns the location) so a provider is configured
 * once. THE KEY IS NOT WRITTEN ANYWHERE: it lives in `turn/provider.ts`'s
 * module memory for this session and vanishes with the process (the OS-keychain
 * story is still to come). Nothing here logs a line, a provider or a key.
 *
 * WHAT IT KEEPS: nothing on the map. The answer is view state of this panel; a
 * close (or a quit) forgets it, and the card is exactly as it was. A turn is
 * not a move — no record, no history line, no mirror rewrite.
 *
 * The port is a PROP (`TurnPort`) rather than an import of the Tauri bridge,
 * in the house idiom: the app passes the real sidecar, and a render test passes
 * a script. The panel never spawns, pipes or kills anything itself.
 *
 * PROVISIONAL (ADR-0003's rendering seam): the panel's shape, the field order
 * and the sentence wording.
 */
export function AskSidecarPanel({
  name,
  turn,
  onClose,
}: {
  /** The anchored card's name — the only map content shown (and not sent). */
  name: string;
  /** The app's turn port: ask one question, stop the running one. */
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
    setRunning(true);
    setStopping(false);
    const result: TurnResult = await turn.ask(
      providerFrom({ baseUrl: base, model: chosen }, apiKey),
      asked,
    );
    setRunning(false);
    setStopping(false);
    if (result.kind === "answer") {
      setAnswer(result.text);
    } else {
      setSentence(result.sentence);
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
        <span className="ground-ask-title">ask about “{name}”</span>
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
      {sentence !== null && (
        <div className="ground-ask-problem" role="status">
          {sentence}
        </div>
      )}
    </div>
  );
}
