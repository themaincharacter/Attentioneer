import {
  modelsRequestLine,
  stopLine,
  type ModelListProvider,
} from "./protocol";
import { createSidecarTransport, startSidecar } from "./sidecar";
import { MODEL_LIST_SENTENCES } from "./modelList";
import { errorSentence, type TurnTransport } from "./turn";

/**
 * THE WINDOW'S ONE FETCH OF A MODEL LIST (Epic 15 story 11).
 *
 * WHY THIS FILE EXISTS: the pure rules (what a list means, how a fetched id is offered) live
 * in modelList.ts; the GET lives in the sidecar; this is the small seam
 * between them. It mirrors the turn's own shape — one request line out, one
 * subscriber by id, one budget — because it uses the SAME transport, the same
 * envelope and the same `error` line. There is no second pipe.
 *
 * NO RETRY, NO CACHE: one press asks once. A timeout asks the sidecar to stop
 * the fetch (so the process does not keep waiting behind a panel that gave up)
 * and reports one sentence. A refused sidecar start is the same sentence the
 * turn's panels show, said without pretending the provider failed.
 *
 * The key crosses this file exactly once, inside the request line it is handed.
 * It is never logged, never stored and never echoed back: the sidecar scrubs an
 * error before it writes it, and nothing here re-reads the key.
 *
 * PROVISIONAL: the budget (20 s) and the sentence wording.
 */

/** How long the panel waits for a provider's list before it gives up. */
export const MODEL_FETCH_TIMEOUT_MS = 20_000;

/** What one fetch answered: the list, or one sentence. */
export type ModelFetchResult =
  | {
      kind: "models";
      /** The ids, sorted and capped by the sidecar. */
      ids: string[];
      /** How many the provider offered before the cap (equal when untruncated). */
      offered: number;
    }
  | { kind: "error"; sentence: string }
  | { kind: "timeout"; sentence: string };

/** What the panel needs: one call, a person's press, one answer. */
export type ModelFetcher = (
  provider: ModelListProvider,
) => Promise<ModelFetchResult>;

/** The window's fetch ids. Separate from the turns' so one can never collide. */
let nextModelFetchId = 1;

/**
 * ONE ASK OF AN ENDPOINT, AND HOW LONG IT TOOK (story 12's test verb).
 *
 * WHY THIS IS HERE AND NOT A SECOND FETCH: "test" and "fetch models" are the
 * same question — GET {baseUrl}/models with this row's key — asked for
 * different reasons. Two implementations would drift into two ideas of what a
 * provider answered, so the test verb calls THIS, the fetch verb calls THIS,
 * and only the words differ. The clock is injected so a test can pin the
 * sentence without sleeping.
 */
export type EndpointAnswer = {
  /** What the one GET answered (the list, or one sentence). */
  result: ModelFetchResult;
  /** Wall time for that answer, in whole milliseconds, never negative. */
  elapsedMs: number;
};

/**
 * Ask once and measure. It adds nothing: the caller decides what the answer
 * means, and a test is a read like any other.
 */
export async function askProviderModels(
  fetcher: ModelFetcher,
  provider: ModelListProvider,
  now: () => number = Date.now,
): Promise<EndpointAnswer> {
  const started = now();
  const result = await fetcher(provider);
  const elapsedMs = Math.max(0, Math.round(now() - started));
  return { result, elapsedMs };
}

/**
 * The test verb's ONE sentence. A success says the endpoint answered and what
 * it offered — no list, no verdict, no second sentence; a failure is the
 * existing scrubbed sentence, unchanged, because the panel already knows how
 * to say a refusal and a second vocabulary would only be a second opinion.
 */
export function connectionSentence(answer: EndpointAnswer): string {
  if (answer.result.kind === "models") {
    const { offered } = answer.result;
    return `the endpoint answered in ${answer.elapsedMs} ms and offered ${offered} models`;
  }
  return answer.result.sentence;
}

export interface ModelFetchOptions {
  /** The panel's own budget (a test uses a short one). */
  timeoutMs?: number;
}

/**
 * Ask the sidecar for one provider's list. The subscriber is registered before
 * the request leaves, so a fast answer cannot outrun it; the budget settles
 * first, then stops the fetch at its source.
 */
export async function fetchModelIds(
  transport: TurnTransport,
  provider: ModelListProvider,
  options: ModelFetchOptions = {},
): Promise<ModelFetchResult> {
  const timeoutMs = options.timeoutMs ?? MODEL_FETCH_TIMEOUT_MS;
  const id = nextModelFetchId++;

  let settle: (result: ModelFetchResult) => void = () => {};
  let unsubscribe: () => void = () => {};
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const result = new Promise<ModelFetchResult>((resolve) => {
    settle = resolve;
  });

  const finish = (answer: ModelFetchResult): void => {
    if (settled) return;
    settled = true;
    if (timer !== null) clearTimeout(timer);
    unsubscribe();
    settle(answer);
  };

  unsubscribe = transport.subscribe(id, (line) => {
    if (settled) return;
    if (line.kind === "models") {
      const ids = line.models.map((model) => model.id);
      finish({
        kind: "models",
        ids,
        offered: line.offered ?? ids.length,
      });
      return;
    }
    if (line.kind === "error") {
      finish({ kind: "error", sentence: errorSentence(line.message) });
      return;
    }
    if (line.kind === "cancelled") {
      finish({ kind: "error", sentence: MODEL_LIST_SENTENCES.stopped });
    }
  });

  timer = setTimeout(() => {
    // Settle FIRST, then let the fetch go: the panel must not show a timeout
    // over a request that is still running.
    finish({ kind: "timeout", sentence: MODEL_LIST_SENTENCES.timeout });
    void transport.send(stopLine(id)).catch(() => {
      // A pipe already gone is the same timeout, said once.
    });
  }, timeoutMs);

  try {
    await transport.send(modelsRequestLine(id, provider));
  } catch {
    finish({ kind: "error", sentence: MODEL_LIST_SENTENCES.unreachable });
  }

  return await result;
}

/**
 * The app's fetcher: make sure the child is up, then ask it. A sidecar that
 * will not start is its own sentence — the provider was never reached, so the
 * panel must not blame it.
 */
export function createModelFetcher(
  transport: TurnTransport = createSidecarTransport(),
): ModelFetcher {
  return async (provider) => {
    const started = await startSidecar();
    if (started.kind === "refused") {
      return { kind: "error", sentence: started.sentence };
    }
    return await fetchModelIds(transport, provider);
  };
}
