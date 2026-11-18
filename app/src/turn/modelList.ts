import {
  baseUrlProblem,
  type HttpProviderRow,
  type ModelRow,
  type ProviderRow,
} from "./providers";

/**
 * THE PROVIDER'S OWN MODEL LIST — read, capped, and laid against a row
 * (Epic 15 story 11).
 *
 * WHY A PURE MODULE: fetching is the sidecar's one `GET`; deciding what the
 * answer MEANS is rules, and rules are testable as values. Everything here is
 * total and side-effect free: a body that is not the OpenAI shape is refused,
 * not guessed at; a fetched id is offered, never forced; a row's existing
 * models are carried through byte for byte.
 *
 * THE THREE RULES THE STORY SETS, in one place:
 *   - A FETCH NEVER WRITES. Merging produces the checklist the person ticks;
 *     only `withTickedModels` turns ticks into a row, and the panel writes it
 *     through the ordinary config write afterwards.
 *   - NOTHING IS REMOVED OR RENAMED. Existing models keep their id, name and
 *     capabilities, in their order; a fetched id that is already there is
 *     marked `onRow` and disabled in the checklist.
 *   - THE CAP IS STATED. The list is capped at `MODEL_LIST_LIMIT` and the
 *     truncation sentence names the count that was offered, never a mystery.
 *
 * PROVISIONAL: the cap (500), the sentence wording, and the fact that an added
 * model claims no capabilities (the provider publishes none; tools and vision
 * stay the person's to edit).
 */

/** How many ids one fetch may list; the rest are counted, not shown. */
export const MODEL_LIST_LIMIT = 500;

/** The sentences a fetch and its checklist say (PROVISIONAL wording). */
export const MODEL_LIST_SENTENCES = {
  /** The provider answered 200 with an empty data array. */
  noModels: "the provider lists no models",
  /** The body was not JSON, or not the OpenAI shape. */
  notTheShape: "the provider's list was not the OpenAI shape",
  notJson: "the provider answered with something that is not JSON",
  /** The one fetch could not leave the machine. */
  unreachable: "the provider could not be reached",
  brokeOff: "the provider's answer broke off",
  /** A fetch was stopped (only a timeout asks for one). */
  stopped: "the fetch was stopped",
  timeout: "the provider did not answer in time",
  sidecar: "the sidecar could not start, so the list was not fetched",
  /** A command has no list: its one model is the command itself. */
  cliNoList:
    "a command has no model list to fetch — its one model is named after the command",
  /** A local row has no list: its one model is the file the person named. */
  localNoList:
    "a model on this machine has no model list to fetch — its one model is the file you named",
  /** Confirm with nothing new ticked: the row is untouched, and says so. */
  nothingTicked: "nothing new was ticked, so the row is unchanged",
  /** Confirm with new ticks: the write landed. */
  added: "the ticked models are on the row",
} as const;

/** Byte-order id comparison: stable everywhere, unlike a locale's collation. */
function orderIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The ids in an OpenAI-shaped body (`data[].id`), trimmed, de-duplicated and
 * sorted. `null` means the body is not that shape at all; an empty array is a
 * provider that says it has no models. A malformed ENTRY is skipped rather
 * than fatal: one strange row must not hide the list around it.
 */
export function readModelIds(payload: unknown): string[] | null {
  if (!isRecord(payload)) return null;
  const data = payload.data;
  if (!Array.isArray(data)) return null;
  const ids = new Set<string>();
  for (const entry of data) {
    if (!isRecord(entry)) continue;
    const id = entry.id;
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (trimmed !== "") ids.add(trimmed);
  }
  return [...ids].sort(orderIds);
}

/** A list after the cap: what is listed, how many were offered, and whether it truncated. */
export interface CappedModelList {
  ids: string[];
  offered: number;
  truncated: boolean;
}

/**
 * The cap, applied to a normalized list. The LIMIT is stated by the caller
 * (the sidecar names the shipped one), so a test can cap at two instead of
 * building five hundred ids to prove the rule.
 */
export function capModelIds(
  ids: readonly string[],
  limit: number = MODEL_LIST_LIMIT,
): CappedModelList {
  const unique = new Set<string>();
  for (const raw of ids) {
    const id = raw.trim();
    if (id !== "") unique.add(id);
  }
  const sorted = [...unique].sort(orderIds);
  const offered = sorted.length;
  const capped = Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : 0;
  return {
    ids: sorted.slice(0, capped),
    offered,
    truncated: offered > capped,
  };
}

/** One id the provider offered, and whether the row already carries it. */
export interface FetchedModel {
  id: string;
  /** Already on the row: shown checked, kept, and never rewritten. */
  onRow: boolean;
}

/**
 * The provider's list against one row: every fetched id once, sorted, and
 * marked when the row already has it. An existing model the provider no
 * longer lists is NOT in the checklist and is NOT removed — a fetch can only
 * ever add.
 */
export function offerFetchedModels(
  row: ProviderRow,
  fetched: readonly string[],
): FetchedModel[] {
  const onRow = new Set(row.models.map((model) => model.id));
  const ids = new Set<string>();
  for (const raw of fetched) {
    const id = raw.trim();
    if (id !== "") ids.add(id);
  }
  return [...ids]
    .sort(orderIds)
    .map((id) => ({ id, onRow: onRow.has(id) }));
}

/**
 * Turn ticks into a row: existing models are carried through untouched, and
 * each ticked id not already there is appended with itself as its name and no
 * claimed capabilities. Ids are trimmed, de-duplicated and never rewritten.
 */
export function withTickedModels(
  row: HttpProviderRow,
  ticked: readonly string[],
): HttpProviderRow {
  const seen = new Set(row.models.map((model) => model.id));
  const models: ModelRow[] = row.models.map((model) => ({
    ...model,
    capabilities: { ...model.capabilities },
  }));
  for (const raw of ticked) {
    const id = raw.trim();
    if (id === "" || seen.has(id)) continue;
    seen.add(id);
    models.push({
      id,
      name: id,
      capabilities: { tools: false, vision: false },
    });
  }
  return { ...row, models };
}

/** The new ids a confirm would add, in the order the checklist was read. */
export function newTickedModels(
  row: ProviderRow,
  ticked: readonly string[],
): string[] {
  const onRow = new Set(row.models.map((model) => model.id));
  const fresh: string[] = [];
  const seen = new Set<string>();
  for (const raw of ticked) {
    const id = raw.trim();
    if (id === "" || onRow.has(id) || seen.has(id)) continue;
    seen.add(id);
    fresh.push(id);
  }
  return fresh;
}

/**
 * The truncation sentence: both numbers, so the cap is a fact rather than a
 * silently shorter list. Only called when the list actually truncated.
 */
export function truncationSentence(offered: number, listed: number): string {
  return (
    "the provider offered " + String(offered) + " models; the first " +
    String(listed) + " are listed"
  );
}

/**
 * Why this row cannot be fetched, or null when it can. The row-only sentences
 * are the ones the panel shows in place of the verb; the HTTP answer is the
 * https/loopback rule again, because a fetch carries the key to the endpoint
 * and an old hand-edited config must not get around story 15.9's rule.
 */
export function modelsFetchProblem(row: ProviderRow): string | null {
  if (row.kind === "cli") return MODEL_LIST_SENTENCES.cliNoList;
  if (row.kind === "local") return MODEL_LIST_SENTENCES.localNoList;
  return baseUrlProblem(row.baseUrl);
}

/**
 * ONE sentence for a non-2xx answer: the status and a short reason, never the
 * key, never a stack trace. 401/403 say the key was refused (the person's
 * likely fix), 404 says there is no list to ask, 5xx says the provider failed.
 */
export function providerRefusal(status: number): string {
  return (
    "the provider answered " + String(status) + " (" + statusReason(status) + ")"
  );
}

function statusReason(status: number): string {
  if (status === 400) return "the request was refused";
  if (status === 401) return "the key was refused";
  if (status === 403) return "the key is not allowed";
  if (status === 404) return "there is no model list at that address";
  if (status === 429) return "too many requests";
  if (status >= 500 && status <= 599) return "the provider failed";
  return "the provider refused the request";
}
