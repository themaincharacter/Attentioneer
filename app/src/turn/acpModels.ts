/**
 * THE TOOL'S OWN MODEL CHOICES (story 22.5; PROVISIONAL).
 *
 * WHAT THIS FILE IS: the pure half of "the tool names its models, the person
 * picks one". A session's answer carries the tool's own `configOptions`; one of
 * them may be its MODEL option, whose `options` list is the choices it offers.
 * This module finds that option and reads its choices — nothing else. It runs
 * no process, reads no store and composes no sentence a card shows.
 *
 * THE VALUE IS OPAQUE. A choice's `value` was observed to be a JSON-encoded
 * array string; that is only one shape it may take. Nothing here parses,
 * normalizes or re-encodes it: the string is kept exactly as the tool wrote it,
 * stored as a fact about this machine, sent back byte-for-byte by the set call.
 * The NAME beside it is the tool's display name, and it is the only side of the
 * pair a person ever reads.
 *
 * THE IDENTITY RULE, AND WHY IT IS NARROW. The model option is found by
 * `category === "model"`, falling back to `id === "model"`; the `type` must be
 * `"select"` because only a select has choices to offer. If neither matches,
 * the tool offers no model choice HERE — the card says one quiet line and shows
 * no picker. Other categories (reasoning effort, for one) are deliberately out
 * of scope: this story asks which model a run answers on, and adding a picker
 * per category is a different story with its own consent question.
 *
 * PROVISIONAL: the field names read here, the identity rule and the fact that a
 * tool's list is captured rather than declared.
 */

/** ONE choice the tool named: its option's id, its display name, its value. */
export interface AcpModelChoice {
  /** The config option's own id — the tool's, sent back verbatim on a set. */
  id: string;
  /** The tool's display name for this choice; the only side a person reads. */
  name: string;
  /** The tool's value string, OPAQUE: kept, stored and sent back byte-for-byte. */
  value: string;
}

/**
 * WHAT ONE ANSWER SAID ABOUT MODELS (PURE). `unknown` is an answer that did not
 * carry an options list at all (an older tool, or no answer yet) and must not
 * erase a fact already recorded; `none` is a list that was there and named no
 * model option, which is the honest "its model is its own setting".
 */
export type AcpModelRead =
  | { read: "named"; models: AcpModelChoice[] }
  | { read: "none" }
  | { read: "unknown" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * THE MODEL OPTION ITSELF, by the identity rule above, or null. The category
 * wins; the bare id is the fallback; a candidate that is not a select is not a
 * choice this story can offer.
 */
function modelOptionOf(
  configOptions: readonly unknown[],
): Record<string, unknown> | null {
  let byCategory: Record<string, unknown> | null = null;
  let byId: Record<string, unknown> | null = null;
  for (const candidate of configOptions) {
    if (!isRecord(candidate)) continue;
    if (typeof candidate.category === "string" && candidate.category === "model") {
      if (byCategory === null) byCategory = candidate;
      continue;
    }
    if (typeof candidate.id === "string" && candidate.id === "model") {
      if (byId === null) byId = candidate;
    }
  }
  const option = byCategory ?? byId;
  if (option === null) return null;
  return option.type === "select" ? option : null;
}

/**
 * THE CHOICES IN ONE SELECT, FLATTENED (PURE). The tool may list values
 * directly (`{value, name}`) or group them (`{group, name, options: [...]}`),
 * and a group may nest in principle, so this walks whatever arrays it finds.
 * A candidate with no usable name or no value is dropped: a choice whose only
 * identity is its value has no honest label, and the value is never shown.
 */
function choicesIn(options: unknown): { name: string; value: string }[] {
  if (!Array.isArray(options)) return [];
  const found: { name: string; value: string }[] = [];
  for (const entry of options) {
    if (!isRecord(entry)) continue;
    if (Array.isArray(entry.options)) {
      found.push(...choicesIn(entry.options));
      continue;
    }
    if (typeof entry.value !== "string" || entry.value === "") continue;
    if (typeof entry.name !== "string" || entry.name.trim() === "") continue;
    found.push({ name: entry.name, value: entry.value });
  }
  return found;
}

/**
 * READ WHAT ONE ANSWER SAID ABOUT MODELS (PURE). An absent list is UNKNOWN, a
 * list with no model option is NONE, and a model select is NAMED with the
 * choices it offered — each carrying that option's own id, because the set call
 * names both the option and the value.
 */
export function readAcpModelChoices(configOptions: unknown): AcpModelRead {
  if (!Array.isArray(configOptions)) return { read: "unknown" };
  const option = modelOptionOf(configOptions);
  if (option === null) return { read: "none" };
  const id = typeof option.id === "string" ? option.id : "";
  if (id === "") return { read: "none" };
  const choices = choicesIn(option.options).map((choice) => ({
    id,
    name: choice.name,
    value: choice.value,
  }));
  if (choices.length === 0) return { read: "none" };
  return { read: "named", models: choices };
}

/**
 * THE CHOICES ONE ANSWER NAMED, as a fact-layer writes them (PURE). `null` means
 * the answer carried no list at all (nothing is claimed, an earlier fact
 * stands); `[]` means it carried one and named no model option, which removes
 * a stale list. This is the one place the "unknown vs none" distinction is
 * made, so a run and a test probe record the same thing.
 */
export function acpModelChoicesOfAnswer(
  configOptions: unknown[] | undefined,
): AcpModelChoice[] | null {
  if (configOptions === undefined) return null;
  const read = readAcpModelChoices(configOptions);
  if (read.read === "named") return read.models;
  if (read.read === "none") return [];
  return null;
}

/**
 * A STORED LIST, BUILT FIELD BY FIELD (PURE). The fact layer keeps exactly
 * `{id, name, value}` and nothing else, so a stray property can never ride into
 * the config file; an entry that cannot be laid over a row honestly is dropped.
 */
export function readAcpModelChoiceList(value: unknown): AcpModelChoice[] {
  if (!Array.isArray(value)) return [];
  const choices: AcpModelChoice[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    if (typeof entry.id !== "string" || entry.id === "") continue;
    if (typeof entry.name !== "string" || entry.name.trim() === "") continue;
    if (typeof entry.value !== "string" || entry.value === "") continue;
    choices.push({ id: entry.id, name: entry.name, value: entry.value });
  }
  return choices;
}

/** THE DISPLAY NAME OF A RECORDED VALUE, or null when the list has no such value. */
export function acpModelNameOf(
  models: readonly AcpModelChoice[],
  value: string,
): string | null {
  return models.find((choice) => choice.value === value)?.name ?? null;
}

/**
 * WHAT A RUN ASKS THE TOOL FOR (PURE): the option id and the value, when the
 * recorded choices hold the value the card's record carries. The id comes from
 * the recorded list — it is the tool's own id, never a constant here.
 */
export function acpRunModelOf(
  models: readonly AcpModelChoice[],
  value: string,
): { optionId: string; value: string } | null {
  const choice = models.find((candidate) => candidate.value === value);
  return choice === undefined ? null : { optionId: choice.id, value: choice.value };
}
