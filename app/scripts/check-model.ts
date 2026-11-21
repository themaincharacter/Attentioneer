import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildInterpreterMessages,
  parseInterpreterAnswer,
  readForMap,
} from "../src/commands/interpreter";
import {
  CURATOR_SCHEMA_KEYS,
  buildCuratorMessages,
  readCuratorAnswer,
  replyCarriedCaveat,
  type CuratorCard,
} from "../src/turn/curator";
import { mapDigest } from "../src/turn/curatorDigest";
import { interpreterDigestOf } from "../src/commands/interpreterDigest";
import {
  parseGround,
  serializeGround,
  type GroundReference,
} from "../src/map/ground";
import {
  parseReadings,
  serializeReadings,
  type Reading,
  type ReadingState,
} from "../src/map/readings";
import {
  parseGroundLinks,
  serializeGroundLinks,
  type GroundLink,
} from "../src/map/groundLinks";
import {
  parseAsks,
  serializeAsks,
  serializeTurns,
  type AskCard,
  type AskTurn,
} from "../src/map/asks";
import { readTurnSettings, resolveManager } from "../src/turn/providers";
import {
  routeOf,
  runRoute,
  type TurnRoute,
  type TurnTransport,
  type TurnResult,
} from "../src/turn/turn";
import { parseSidecarLine, type SidecarLine } from "../src/turn/protocol";
import type { TurnMessage } from "../src/turn/protocol";
import {
  BATTERY_CARDS,
  CURATOR_BATTERY,
  CURATOR_QUESTION,
  INTERPRETER_BATTERY,
  type BatteryName,
  type CuratorCase,
  type InterpreterCase,
} from "./check-model-battery";

/**
 * STORY 23.1 — "bun run check:model": A BOUNDED REAL-MODEL BATTERY.
 *
 * WHY: two questions can only be answered by a real model, and both blocked
 * judgement — does the curator still DECLINE now that its caps are gone, and
 * how slow is the command card's interpretation in wall-clock terms? Waiting
 * for the person's own pass made both depend on them sitting at the window.
 *
 * WHAT IT IS: a FIXED battery (scripts/check-model-battery.ts) run through the
 * APP'S OWN prompt builders and parsers (turn/curator.ts and
 * commands/interpreter.ts) against the configured provider, and the answers
 * counted — never graded. A row is an instruction or a reply; each runs ONCE.
 *
 * BOUNDED AND STATED, and --yes IS REQUIRED. The run prints what it is about
 * to do and how many calls BEFORE the first one; without --yes it prints the
 * plan and exits 0 having called nothing, because a person must not spend
 * tokens by typo. --max-calls refuses a battery that would run past it.
 *
 * THE KEY IS NEVER PRINTED. It is read the way the app reads it (the stated
 * fallback file beside the config — this script cannot reach the OS keychain),
 * handed to the ONE request line, and never put in a sentence, a line or the
 * report. The report is scrubbed of it once more before it is written.
 *
 * NOTHING IS WRITTEN TO A MAP. The digest the prompts carry is composed from a
 * TEMPORARY workspace holding fixed cards, built and deleted inside the run.
 *
 * A FAILURE IS DATA. A provider error is a ROW that says what happened; only
 * an auth refusal stops the run, with ONE sentence (there is nothing to learn
 * from repeating it 30 times).
 *
 * PROVISIONAL (the story's own list): the report's shape, the default cap, and
 * the battery's contents.
 */

/** The report's fenced block opener/closer, built without a literal backtick. */
const FENCE = String.fromCharCode(96).repeat(3);

/* ------------------------------------------------------------------ *
 * The flags
 * ------------------------------------------------------------------ */

/** The one line a missing or bad flag answers. */
export const CHECK_USAGE =
  "usage: bun run check:model --yes [--max-calls N] [--only interpreter|curator] [--out PATH]";

/** The cap when the person names none (PROVISIONAL). */
export const CHECK_DEFAULT_MAX_CALLS = 30;

/** What one run was asked to do. */
export interface CheckOptions {
  /** False means: print the plan, call nothing, exit 0. */
  yes: boolean;
  /** The ceiling on calls for this run. */
  maxCalls: number;
  /** Both batteries, or just the one named. */
  only: BatteryName | null;
  /** The report's path; the JSON sibling shares its base name. */
  out: string | null;
}

/** Read one flag's value from argv, or null. */
function flagValue(argv: readonly string[], flag: string): string | null {
  const at = argv.indexOf(flag);
  if (at === -1) return null;
  const value = argv[at + 1];
  return value === undefined || value.startsWith("--") ? null : value;
}

/** Parse argv into options, or ONE sentence saying what is wrong. */
export function parseCheckArgs(
  argv: readonly string[],
): CheckOptions | { refused: string } {
  const maxText = flagValue(argv, "--max-calls");
  let maxCalls = CHECK_DEFAULT_MAX_CALLS;
  if (maxText !== null) {
    if (!/^\d+$/.test(maxText)) {
      return { refused: "--max-calls needs a whole number of calls." };
    }
    maxCalls = Number(maxText);
  }
  const onlyText = flagValue(argv, "--only");
  let only: BatteryName | null = null;
  if (onlyText !== null) {
    if (onlyText !== "interpreter" && onlyText !== "curator") {
      return { refused: "--only names interpreter or curator." };
    }
    only = onlyText;
  }
  const known = new Set(["--yes", "--max-calls", "--only", "--out"]);
  for (const arg of argv) {
    if (arg.startsWith("--") && !known.has(arg)) {
      return { refused: "there is no " + arg + " flag here." };
    }
  }
  return {
    yes: argv.includes("--yes"),
    maxCalls,
    only,
    out: flagValue(argv, "--out"),
  };
}

/* ------------------------------------------------------------------ *
 * The provider, read the way the app reads it
 * ------------------------------------------------------------------ */

/** Where the app keeps its config and the stated fallback secrets file. */
export function configDirOf(
  env: Record<string, string | undefined>,
  platform: string,
): string {
  if (platform === "win32") return join(env.APPDATA ?? "", "attentioneer");
  if (platform === "darwin") {
    return join(env.HOME ?? "", "Library", "Application Support", "attentioneer");
  }
  const xdg = env.XDG_CONFIG_HOME ?? "";
  if (xdg !== "") return join(xdg, "attentioneer");
  return join(env.HOME ?? "", ".config", "attentioneer");
}

/** What the run needs to know about the provider, before a call. */
export interface ProviderFacts {
  /** The row's own name, for the plan. */
  rowName: string;
  /** The row's id, so the plan can say which account holds the key. */
  rowId: string;
  /** The model the manager row resolves to. */
  managerModelId: string;
  /** The task row's model, named in the report and NOT called here. */
  taskModelId: string;
  /** The one route both cards call (the manager row). */
  route: TurnRoute;
  /** The key, for the request line only. It is never printed. */
  apiKey: string;
}

/** The one sentence when nothing can leave. */
export const CHECK_SENTENCES = {
  noConfig: "no provider row is configured, so nothing can be measured.",
  noManager: "the manager row does not resolve, so nothing can be measured.",
  notEndpoint:
    "the manager row is not an endpoint row, so this battery cannot time it.",
  noKey:
    "no key is kept in the stated fallback file, and this battery does not read the OS keychain.",
  noWorkspace: "the temporary fixture workspace could not be made.",
  pastCap: "the selected battery runs past the call cap.",
  sidecar: "the sidecar could not be started, so nothing was measured.",
  threw: "the call threw before it settled.",
} as const;

/** Read the turn settings' pair of rows, and the one key for the manager row. */
export function providerFactsOf(
  configText: string | null,
  secretsText: string | null,
): ProviderFacts | { refused: string } {
  let config: unknown = null;
  try {
    config = configText === null ? null : JSON.parse(configText);
  } catch {
    config = null;
  }
  const settings =
    typeof config === "object" && config !== null
      ? readTurnSettings((config as Record<string, unknown>).turn)
      : readTurnSettings(undefined);
  const task = settings.providers.find((row) => row.id === settings.providerId);
  const manager = resolveManager(settings);
  if (task === undefined) return { refused: CHECK_SENTENCES.noConfig };
  if (manager.kind !== "resolved") return { refused: CHECK_SENTENCES.noManager };
  if (manager.provider.kind !== "http") {
    return { refused: CHECK_SENTENCES.notEndpoint };
  }
  let secrets: Record<string, unknown> = {};
  try {
    const parsed: unknown = secretsText === null ? {} : JSON.parse(secretsText);
    if (typeof parsed === "object" && parsed !== null) {
      secrets = parsed as Record<string, unknown>;
    }
  } catch {
    secrets = {};
  }
  const kept = secrets[manager.provider.id];
  if (typeof kept !== "string" || kept === "") {
    return { refused: CHECK_SENTENCES.noKey };
  }
  return {
    rowName: manager.provider.name,
    rowId: manager.provider.id,
    managerModelId: manager.model.id,
    taskModelId: settings.modelId,
    route: routeOf(manager.provider, manager.model, kept),
    apiKey: kept,
  };
}

/* ------------------------------------------------------------------ *
 * The fixtures: a TEMPORARY workspace, its digests, and its deletion
 * ------------------------------------------------------------------ */

/** The one clock value the fixture records carry (fixed, so runs differ by nothing). */
const FIXTURE_TAKEN = "2026-11-21T00:00:00.000Z";

/** The two digest strings the prompts carry, and nothing else. */
export interface FixtureDigests {
  /** The curator's map digest (turn/curatorDigest.ts). */
  curator: string;
  /** The interpreter's map digest (commands/interpreterDigest.ts). */
  interpreter: string;
}

/**
 * Build the temporary workspace, compose BOTH digests through the app's own
 * composers, then delete it. The fixtures are fixed cards; the person's map is
 * untouched, and the run leaves nothing behind.
 */
export function buildFixtureDigests(workspacePath: string): FixtureDigests {
  const references: GroundReference[] = [
    BATTERY_CARDS.curatorCaps,
    BATTERY_CARDS.commandCard,
    BATTERY_CARDS.providerPanel,
    BATTERY_CARDS.sendPath,
  ].map((card) => ({ on: card.on, name: card.name, x: card.x, y: card.y }));
  const readings: Reading[] = [
    {
      on: BATTERY_CARDS.curatorCaps.on,
      form: "url",
      from: "https://example.org/caps",
      taken: FIXTURE_TAKEN,
    },
    {
      on: BATTERY_CARDS.commandCard.on,
      form: "url",
      from: "https://example.org/command",
      taken: FIXTURE_TAKEN,
    },
    {
      on: BATTERY_CARDS.providerPanel.on,
      form: "path",
      from: "notes/provider-panel.md",
      taken: FIXTURE_TAKEN,
    },
  ];
  const links: GroundLink[] = [
    { from: BATTERY_CARDS.commandCard.on, to: BATTERY_CARDS.sendPath.on },
  ];
  const asks: AskCard[] = [
    {
      on: BATTERY_CARDS.ask.on,
      name: BATTERY_CARDS.ask.name,
      x: BATTERY_CARDS.ask.x,
      y: BATTERY_CARDS.ask.y,
    },
  ];
  const turns: AskTurn[] = [
    { role: "person", text: "how slow is the command card?", t: FIXTURE_TAKEN },
    {
      role: "answer",
      text: "one model round trip per press, and the wait is the interpretation.",
      t: FIXTURE_TAKEN,
    },
  ];

  mkdirSync(join(workspacePath, "map", "asks"), { recursive: true });
  writeFileSync(
    join(workspacePath, "map", "ground.txt"),
    serializeGround(references),
    "utf8",
  );
  writeFileSync(
    join(workspacePath, "map", "readings.txt"),
    serializeReadings(readings),
    "utf8",
  );
  writeFileSync(
    join(workspacePath, "map", "ground-links.txt"),
    serializeGroundLinks(links),
    "utf8",
  );
  writeFileSync(
    join(workspacePath, "map", "asks.txt"),
    serializeAsks(asks),
    "utf8",
  );
  writeFileSync(
    join(workspacePath, "map", "asks", BATTERY_CARDS.ask.on + ".jsonl"),
    serializeTurns(turns),
    "utf8",
  );

  // READ IT BACK through the app's own parsers, so the digest comes from the
  // workspace's bytes and not from the objects that wrote them.
  const ground = parseGround(
    readFileSync(join(workspacePath, "map", "ground.txt"), "utf8"),
  );
  const readReadings = parseReadings(
    readFileSync(join(workspacePath, "map", "readings.txt"), "utf8"),
  );
  const readLinks = parseGroundLinks(
    readFileSync(join(workspacePath, "map", "ground-links.txt"), "utf8"),
  );
  const readAsks = parseAsks(
    readFileSync(join(workspacePath, "map", "asks.txt"), "utf8"),
  );
  const states: Record<string, ReadingState> = {
    [BATTERY_CARDS.curatorCaps.on]: "current",
  };

  const curator = mapDigest({
    anchorSlug: BATTERY_CARDS.ask.on,
    anchorKind: "ask",
    wired: [BATTERY_CARDS.commandCard.on],
    references: ground.references,
    asks: readAsks.asks,
    askTurns: { [BATTERY_CARDS.ask.on]: turns },
    sessions: [],
    readings: readReadings.readings,
  });
  const interpreter = interpreterDigestOf({
    map: "ground",
    references: ground.references,
    asks: readAsks.asks,
    sessions: [],
    readings: readReadings.readings,
    links: readLinks.links,
    states,
  });
  return { curator, interpreter };
}

/* ------------------------------------------------------------------ *
 * The rows and the counts
 * ------------------------------------------------------------------ */

/** What one interpreter row found. */
export interface InterpreterRow {
  index: number;
  kind: string;
  instruction: string;
  instructionChars: number;
  ms: number;
  outcome: "acts" | "question" | "refusal" | "error";
  acts: string[];
  question: string | null;
  sentence: string | null;
  /** The answer's bytes when the call answered; null when it did not. */
  answer: string | null;
}

/** What one curator row found. */
export interface CuratorRow {
  index: number;
  kind: string;
  reply: string;
  replyChars: number;
  replyWords: number;
  ms: number;
  outcome: "card" | "declined" | "unusable" | "error";
  sentence: string | null;
  /** The answer's bytes when the call answered; null when it did not. */
  answer: string | null;
  card: CuratorCard | null;
  cardChars: number | null;
  cardWords: number | null;
  /** Each schema field's length in characters, when a card was made. */
  fields: Record<string, number> | null;
  /** Did the app's own cue list fire on the reply? */
  cueInReply: boolean;
  /** True when a card kept the reply's caveat; null when no card was made. */
  caveatKept: boolean | null;
  /** True when the parser's refusal was the caveat rule itself. */
  caveatDropped: boolean;
}

/** The counts a report carries (no scores, no grades). */
export interface CheckCounts {
  interpreter: Record<InterpreterRow["outcome"], number>;
  curator: Record<CuratorRow["outcome"], number>;
  calls: number;
}

/** One answer, timed. */
async function timedSend(
  send: (messages: readonly TurnMessage[]) => Promise<TurnResult>,
  messages: readonly TurnMessage[],
  now: () => number,
): Promise<{ result: TurnResult; ms: number }> {
  const started = now();
  const result = await send(messages);
  return { result, ms: Math.max(0, Math.round(now() - started)) };
}

/** Words and characters, the report's only two measures of size. */
function sizeOf(text: string): { chars: number; words: number } {
  const trimmed = text.trim();
  return {
    chars: Array.from(trimmed).length,
    words: trimmed === "" ? 0 : trimmed.split(/\s+/).length,
  };
}

/** Run one interpreter row: the app's prompt, one call, the app's parser. */
async function runInterpreterRow(
  which: InterpreterCase,
  index: number,
  digest: string,
  send: (messages: readonly TurnMessage[]) => Promise<TurnResult>,
  now: () => number,
): Promise<InterpreterRow> {
  const messages = buildInterpreterMessages({
    instruction: which.instruction,
    digest,
    map: "ground",
  });
  let result: TurnResult;
  let ms: number;
  try {
    const timed = await timedSend(send, messages, now);
    result = timed.result;
    ms = timed.ms;
  } catch {
    result = { kind: "error", sentence: CHECK_SENTENCES.threw };
    ms = 0;
  }
  const base = {
    index,
    kind: which.kind,
    instruction: which.instruction,
    instructionChars: Array.from(which.instruction).length,
    ms,
    answer: result.kind === "answer" ? result.text : null,
  };
  if (result.kind !== "answer" || result.text === "") {
    return {
      ...base,
      outcome: "error",
      acts: [],
      question: null,
      sentence:
        result.kind === "answer"
          ? "the interpreter answered with nothing."
          : result.sentence,
    };
  }
  // THE APP'S OWN READER, on the ground map: the same parse-and-map pair the
  // card runs (readForMap is a passthrough for ground and is called anyway, so
  // this battery reads an answer exactly the way the card does).
  const read = readForMap(parseInterpreterAnswer(result.text), "ground");
  if (read.kind === "acts") {
    return {
      ...base,
      outcome: "acts",
      acts: read.acts.map((act) => act.act),
      question: null,
      sentence: null,
    };
  }
  if (read.kind === "question") {
    return {
      ...base,
      outcome: "question",
      acts: [],
      question: read.question,
      sentence: null,
    };
  }
  return {
    ...base,
    outcome: "refusal",
    acts: [],
    question: null,
    sentence: read.sentence,
  };
}

/**
 * Was this refusal the CAVEAT RULE? The parser returns the same sentence for
 * every malformed shape, so the run reads the SAME answer against a reply the
 * cue list cannot fire on: if that makes a card, the only difference was the
 * caveat the reply carried. Uses the app's reader twice, never a second parser.
 */
function refusalWasTheCaveat(answer: string, reply: string): boolean {
  if (readCuratorAnswer(answer, reply).kind !== "invalid") return false;
  return readCuratorAnswer(answer, "").kind === "card";
}

/** Run one curator row: the app's prompt, one call, the app's reader. */
async function runCuratorRow(
  which: CuratorCase,
  index: number,
  digest: string,
  send: (messages: readonly TurnMessage[]) => Promise<TurnResult>,
  now: () => number,
): Promise<CuratorRow> {
  const messages = buildCuratorMessages({
    question: CURATOR_QUESTION,
    reply: which.reply,
    digest,
  });
  let result: TurnResult;
  let ms: number;
  try {
    const timed = await timedSend(send, messages, now);
    result = timed.result;
    ms = timed.ms;
  } catch {
    result = { kind: "error", sentence: CHECK_SENTENCES.threw };
    ms = 0;
  }
  const replySize = sizeOf(which.reply);
  const base = {
    index,
    kind: which.kind,
    reply: which.reply,
    replyChars: replySize.chars,
    replyWords: replySize.words,
    ms,
    cueInReply: replyCarriedCaveat(which.reply),
    answer: result.kind === "answer" ? result.text : null,
  };
  if (result.kind !== "answer" || result.text === "") {
    return {
      ...base,
      outcome: "error",
      sentence:
        result.kind === "answer"
          ? "the curator answered with nothing."
          : result.sentence,
      card: null,
      cardChars: null,
      cardWords: null,
      fields: null,
      caveatKept: null,
      caveatDropped: false,
    };
  }
  const read = readCuratorAnswer(result.text, which.reply);
  if (read.kind === "card") {
    const textSize = sizeOf(read.text);
    const fields: Record<string, number> = {};
    for (const key of CURATOR_SCHEMA_KEYS) {
      const value =
        key === "rests on"
          ? read.card.restsOn
          : key === "does not cover"
            ? read.card.doesNotCover
            : read.card[key];
      fields[key] = Array.from(value.trim()).length;
    }
    return {
      ...base,
      outcome: "card",
      sentence: null,
      card: read.card,
      cardChars: textSize.chars,
      cardWords: textSize.words,
      fields,
      caveatKept: base.cueInReply ? true : null,
      caveatDropped: false,
    };
  }
  if (read.kind === "declined") {
    return {
      ...base,
      outcome: "declined",
      sentence: read.sentence,
      card: null,
      cardChars: null,
      cardWords: null,
      fields: null,
      caveatKept: null,
      caveatDropped: false,
    };
  }
  return {
    ...base,
    outcome: "unusable",
    sentence: read.sentence,
    card: null,
    cardChars: null,
    cardWords: null,
    fields: null,
    caveatKept: null,
    caveatDropped: refusalWasTheCaveat(result.text, which.reply),
  };
}

/** Count the rows by outcome (counts only — the report grades nothing). */
export function countsOf(
  interpreterRows: readonly InterpreterRow[],
  curatorRows: readonly CuratorRow[],
): CheckCounts {
  const interpreter = { acts: 0, question: 0, refusal: 0, error: 0 };
  for (const row of interpreterRows) interpreter[row.outcome] += 1;
  const curator = { card: 0, declined: 0, unusable: 0, error: 0 };
  for (const row of curatorRows) curator[row.outcome] += 1;
  return {
    interpreter,
    curator,
    calls: interpreterRows.length + curatorRows.length,
  };
}

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

/** What one run writes. */
export interface CheckReport {
  markdown: string;
  json: string;
  /** The report's path, and its JSON sibling. */
  out: string;
  outJson: string;
}

/** The ISO stamp a report's file name carries (colons are not a file name). */
export function reportStamp(at: number): string {
  return new Date(at)
    .toISOString()
    .replace(/\.\d+Z$/, "Z")
    .replace(/:/g, "-");
}

/** One text, quoted the way a person reads it (never truncated). */
function quoted(text: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => "> " + line)
    .join("\n");
}

/** The slowest and fastest phrasings, as the story asks (milliseconds only). */
function timesOf(rows: readonly InterpreterRow[]): {
  slowest: InterpreterRow[];
  fastest: InterpreterRow[];
} {
  const sorted = [...rows].sort((left, right) => right.ms - left.ms);
  return { slowest: sorted.slice(0, 3), fastest: sorted.slice(-3).reverse() };
}

/** The provider facts a report may carry (never the key). */
export interface ReportFacts {
  rowName: string;
  rowId: string;
  managerModelId: string;
  taskModelId: string;
}

/** Build the markdown report. PURE over the rows. */
export function renderReport(input: {
  at: number;
  facts: ReportFacts;
  cap: number;
  only: BatteryName | null;
  digests: FixtureDigests;
  interpreterRows: readonly InterpreterRow[];
  curatorRows: readonly CuratorRow[];
  stopped: string | null;
}): string {
  const counts = countsOf(input.interpreterRows, input.curatorRows);
  const lines: string[] = [];
  lines.push("# model check — " + new Date(input.at).toISOString());
  lines.push("");
  lines.push(
    "A fixed battery run through the app's OWN prompt builders and parsers. " +
      "No scores and no grades: counts, milliseconds, characters and words only.",
  );
  lines.push("");
  lines.push(
    "- the provider row: " + input.facts.rowName + " (" + input.facts.rowId + ")",
  );
  lines.push("- the manager row both cards call: " + input.facts.managerModelId);
  lines.push(
    "- the task row (named, not called by this battery): " + input.facts.taskModelId,
  );
  lines.push(
    "- the battery: " +
      (input.only === null
        ? INTERPRETER_BATTERY.length +
          " interpreter phrasings + " +
          CURATOR_BATTERY.length +
          " curator replies"
        : input.only +
          " only (" +
          (input.only === "interpreter"
            ? INTERPRETER_BATTERY.length
            : CURATOR_BATTERY.length) +
          " rows)"),
  );
  lines.push("- the cap: " + input.cap + " calls (--max-calls)");
  lines.push("- calls made: " + counts.calls);
  lines.push(
    "- the digest: fixed cards in a temporary workspace, read back through the app's parsers and deleted after the run",
  );
  lines.push("");

  if (input.stopped !== null) {
    lines.push("## the run stopped");
    lines.push("");
    lines.push(input.stopped);
    lines.push("");
  }

  lines.push("## the map digest the interpreter was handed");
  lines.push("");
  lines.push(FENCE);
  lines.push(input.digests.interpreter);
  lines.push(FENCE);
  lines.push("");
  lines.push("## the map digest the curator was handed");
  lines.push("");
  lines.push(FENCE);
  lines.push(input.digests.curator);
  lines.push(FENCE);
  lines.push("");

  if (input.interpreterRows.length > 0) {
    lines.push(
      "## the interpreter — " +
        input.interpreterRows.length +
        " phrasings, each once",
    );
    lines.push("");
    for (const row of input.interpreterRows) {
      lines.push(
        "### " +
          row.index +
          " · " +
          row.kind +
          " · " +
          row.ms +
          " ms · " +
          row.outcome +
          (row.outcome === "acts" ? " (" + row.acts.length + ")" : ""),
      );
      lines.push("");
      lines.push(quoted(row.instruction));
      lines.push("");
      if (row.outcome === "acts") {
        lines.push(
          "acts: " + (row.acts.length === 0 ? "none" : row.acts.join(" → ")),
        );
      } else if (row.outcome === "question") {
        lines.push("question: " + (row.question ?? ""));
      } else {
        lines.push("sentence: " + (row.sentence ?? ""));
        // EVERY FAILURE IN FULL: the app's sentence says what the parser did,
        // and the answer beside it says what the model actually wrote.
        if (row.answer !== null) {
          lines.push("");
          lines.push("the answer, in full:");
          lines.push("");
          lines.push(quoted(row.answer));
        }
      }
      lines.push("");
    }
  }

  if (input.curatorRows.length > 0) {
    lines.push(
      "## the curator — " + input.curatorRows.length + " replies, each once",
    );
    lines.push("");
    for (const row of input.curatorRows) {
      lines.push(
        "### " +
          row.index +
          " · " +
          row.kind +
          " · " +
          row.ms +
          " ms · " +
          row.outcome +
          (row.cardChars === null
            ? ""
            : " (" + row.cardChars + " characters, " + row.cardWords + " words)"),
      );
      lines.push("");
      lines.push(
        "reply: " + row.replyChars + " characters, " + row.replyWords + " words",
      );
      // THE CAVEAT COLUMN, in words that are true for a card with nothing to
      // keep: a card made from a reply with no cue is not a dropped caveat.
      lines.push(
        "caveat in the reply: " +
          (row.cueInReply ? "yes" : "no") +
          " · caveats kept: " +
          (row.cardChars === null
            ? "no card was made"
            : row.cueInReply
              ? "yes"
              : "no caveat to keep") +
          (row.caveatDropped ? " · the refusal was the caveat rule" : ""),
      );
      if (row.fields !== null) {
        lines.push(
          "card fields: " +
            CURATOR_SCHEMA_KEYS.map(
              (key) => key + " " + row.fields?.[key] + " characters",
            ).join(" · "),
        );
      }
      if (row.sentence !== null) lines.push("sentence: " + row.sentence);
      // AN UNUSABLE ANSWER IS A FAILURE, so it is shown in full: the app's one
      // sentence says the shape was not a card, and the answer says why.
      if (row.answer !== null && row.outcome === "unusable") {
        lines.push("");
        lines.push("the answer, in full:");
        lines.push("");
        lines.push(quoted(row.answer));
      }
      lines.push("");
      lines.push(quoted(row.reply));
      lines.push("");
    }
  }

  const { slowest, fastest } = timesOf(input.interpreterRows);
  lines.push("## the counts");
  lines.push("");
  lines.push(
    "interpreter: acts " +
      counts.interpreter.acts +
      " · question " +
      counts.interpreter.question +
      " · refusal " +
      counts.interpreter.refusal +
      " · provider error " +
      counts.interpreter.error,
  );
  lines.push(
    "curator: card " +
      counts.curator.card +
      " · decline " +
      counts.curator.declined +
      " · unusable " +
      counts.curator.unusable +
      " · provider error " +
      counts.curator.error,
  );
  if (slowest.length > 0) {
    lines.push(
      "slowest phrasings: " +
        slowest
          .map((row) => row.ms + " ms (row " + row.index + ", " + row.kind + ")")
          .join("; "),
    );
    lines.push(
      "fastest phrasings: " +
        fastest
          .map((row) => row.ms + " ms (row " + row.index + ", " + row.kind + ")")
          .join("; "),
    );
  }
  const carded = input.curatorRows.filter((row) => row.cardChars !== null);
  if (carded.length > 0) {
    const longest = carded.reduce((best, row) =>
      (row.cardChars ?? 0) > (best.cardChars ?? 0) ? row : best,
    );
    lines.push(
      "longest card: " +
        String(longest.cardChars) +
        " characters (row " +
        String(longest.index) +
        ")",
    );
  }
  const cueRows = input.curatorRows.filter((row) => row.cueInReply);
  if (cueRows.length > 0) {
    lines.push(
      "caveats: " +
        cueRows.length +
        " replies carried a cue; cards that kept them: " +
        cueRows.filter((row) => row.caveatKept === true).length +
        "; refusals that were the caveat rule: " +
        cueRows.filter((row) => row.caveatDropped).length +
        "; rows that made no card: " +
        cueRows.filter(
          (row) => row.outcome === "declined" || row.outcome === "unusable",
        ).length,
    );
  }
  lines.push("");
  lines.push(
    "The battery is PROVISIONAL (story 23.1): its phrasings, its replies and the cap are first choices.",
  );
  lines.push("");
  return lines.join("\n");
}

/** The JSON sibling: the same rows, machine-readable. */
export function renderJson(input: {
  at: number;
  facts: ReportFacts;
  cap: number;
  only: BatteryName | null;
  counts: CheckCounts;
  interpreterRows: readonly InterpreterRow[];
  curatorRows: readonly CuratorRow[];
  stopped: string | null;
}): string {
  return JSON.stringify(
    {
      ranAt: new Date(input.at).toISOString(),
      provider: input.facts,
      cap: input.cap,
      only: input.only,
      counts: input.counts,
      stopped: input.stopped,
      interpreter: input.interpreterRows,
      curator: input.curatorRows,
    },
    null,
    2,
  );
}

/* ------------------------------------------------------------------ *
 * The sender: the app's own send path, over a sidecar this script owns
 * ------------------------------------------------------------------ */

/** The app directory (this script runs from the app folder). */
function appDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * The transport the card has, minus Tauri: the SAME sidecar process, the SAME
 * request line, the SAME turn. The host that owns the child is this script.
 */
export function createNodeTransport(): {
  transport: TurnTransport;
  /** The sidecar's stderr, bounded, for a sentence — never a report field. */
  diagnostics: () => string;
  close: () => Promise<void>;
} {
  const child = Bun.spawn({
    cmd: [process.execPath, "sidecar/main.ts"],
    cwd: appDir(),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const waiting = new Map<number, (line: SidecarLine) => void>();
  let stderrText = "";
  let helloed = false;
  let helloResolve: () => void = () => {};
  let helloReject: (error: Error) => void = () => {};
  const hello = new Promise<void>((resolveHello, rejectHello) => {
    helloResolve = resolveHello;
    helloReject = rejectHello;
  });
  void hello.catch(() => {
    // The first send awaits it and reports the refusal there.
  });
  const helloTimer = setTimeout(() => {
    helloReject(new Error(CHECK_SENTENCES.sidecar));
  }, 10_000);

  const decoder = new TextDecoder();
  let buffer = "";
  void (async () => {
    try {
      for await (const chunk of child.stdout as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const raw = buffer.slice(0, newline).replace(/\r$/, "");
          buffer = buffer.slice(newline + 1);
          const line = parseSidecarLine(raw);
          if (line === null) {
            // Not ours: ignore, never report a line we did not ask for.
          } else if (line.kind === "hello") {
            helloed = true;
            clearTimeout(helloTimer);
            helloResolve();
          } else {
            waiting.get(line.id)?.(line);
          }
          newline = buffer.indexOf("\n");
        }
      }
    } finally {
      helloReject(new Error(CHECK_SENTENCES.sidecar));
    }
  })();
  void (async () => {
    const errDecoder = new TextDecoder();
    try {
      for await (const chunk of child.stderr as AsyncIterable<Uint8Array>) {
        if (stderrText.length < 2000) {
          stderrText += errDecoder.decode(chunk, { stream: true });
        }
      }
    } catch {
      // A closed stderr changes nothing about the answer.
    }
  })();

  const transport: TurnTransport = {
    async send(line) {
      if (!helloed) await hello;
      child.stdin.write(line + "\n");
      await child.stdin.flush();
    },
    subscribe(id, handler) {
      waiting.set(id, handler);
      return () => {
        waiting.delete(id);
      };
    },
  };
  return {
    transport,
    diagnostics: () => stderrText.trim(),
    async close() {
      clearTimeout(helloTimer);
      try {
        child.stdin.end();
      } catch {
        // Already gone.
      }
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    },
  };
}

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

/** What this script needs from the world; a test passes its own. */
export interface ModelCheckDeps {
  /** The app config's bytes, or null when there is none. */
  readConfig: () => string | null;
  /** The stated fallback secrets file's bytes, or null. */
  readSecrets: () => string | null;
  /** Build the sender for the one route (the real one spawns the sidecar). */
  makeSend: (route: TurnRoute) => {
    send: (messages: readonly TurnMessage[]) => Promise<TurnResult>;
    close: () => Promise<void>;
  };
  /** The clock, in milliseconds (the report's timings come from it). */
  now: () => number;
  /** A fresh empty folder for the fixtures; the run deletes it. */
  newWorkspace: () => string;
  /**
   * Print one line AS IT HAPPENS. The plan MUST be on screen before the first
   * call leaves, so the run cannot collect its lines and print them at the end;
   * a test passes nothing and reads the returned lines instead.
   */
  print?: (line: string) => void;
}

/** What one run returned. */
export interface ModelCheckResult {
  /** The process exit code (0 green, 1 refused). */
  code: number;
  /** Everything the run printed, in order. */
  lines: readonly string[];
  /** The report written, or null when nothing was written. */
  report: CheckReport | null;
}

/** The one sentence an auth refusal stops on (a provider error is a row). */
export function isAuthRefusal(sentence: string): boolean {
  return /answered (401|403)\b|the key was refused|unauthorized|authentication failed|invalid api key|incorrect api key/i.test(
    sentence,
  );
}

/** Take the key out of any text this run writes. It should never be there. */
function withoutSecret(text: string, secret: string): string {
  return secret === "" ? text : text.split(secret).join("[the key was removed]");
}

/**
 * RUN the battery and write the report. Nothing here prints: the caller prints
 * the lines, so a test drives exactly what the person runs.
 */
export async function runModelCheck(
  argv: readonly string[],
  deps: ModelCheckDeps,
): Promise<ModelCheckResult> {
  const lines: string[] = [];
  /** Say one line now (the plan before the first call) and keep it. */
  const say = (line: string): void => {
    lines.push(line);
    deps.print?.(line);
  };
  const parsed = parseCheckArgs(argv);
  if ("refused" in parsed) {
    say(parsed.refused);
    say(CHECK_USAGE);
    return { code: 1, lines, report: null };
  }
  const selected = {
    interpreter: parsed.only === null || parsed.only === "interpreter",
    curator: parsed.only === null || parsed.only === "curator",
  };
  const planned =
    (selected.interpreter ? INTERPRETER_BATTERY.length : 0) +
    (selected.curator ? CURATOR_BATTERY.length : 0);
  // THE REPORT'S CLOCK IS THE WALL CLOCK, the timings use the deps' clock: a
  // run's date is a fact about the run, and a monotonic clock starts at boot.
  const at = Date.now();
  const outMd =
    parsed.out ??
    resolve(appDir(), "..", "notes", "model-check-" + reportStamp(at) + ".md");
  const outJson = outMd.replace(/\.md$/, "") + ".json";

  const facts = providerFactsOf(deps.readConfig(), deps.readSecrets());
  say(
    "model check — a fixed battery through the app's own prompts and parsers",
  );
  if ("refused" in facts) {
    say(facts.refused);
    return { code: 1, lines, report: null };
  }
  say("the provider row: " + facts.rowName + " (" + facts.rowId + ")");
  say("the manager row both cards call: " + facts.managerModelId);
  say(
    "the task row (named, not called by this battery): " + facts.taskModelId,
  );
  say(
    "the battery: " +
      (parsed.only === null
        ? INTERPRETER_BATTERY.length +
          " interpreter phrasings + " +
          CURATOR_BATTERY.length +
          " curator replies"
        : parsed.only +
          " only (" +
          (parsed.only === "interpreter"
            ? INTERPRETER_BATTERY.length
            : CURATOR_BATTERY.length) +
          " rows)"),
  );
  say("the cap: " + parsed.maxCalls + " calls (--max-calls)");
  say("the report: " + outMd + " and " + outJson);
  if (planned > parsed.maxCalls) {
    say(
      "the selected battery is " +
        planned +
        " calls, past the cap of " +
        parsed.maxCalls +
        ": " +
        CHECK_SENTENCES.pastCap +
        " Nothing was called.",
    );
    return { code: 1, lines, report: null };
  }
  if (!parsed.yes) {
    say("nothing was called: pass --yes to run " + planned + " call(s).");
    return { code: 0, lines, report: null };
  }
  say(
    "about to make " + planned + " call(s), one per row, and print each as it ends.",
  );
  say("");

  // THE FIXTURES: a temporary workspace, two digests from it, then gone.
  let digests: FixtureDigests;
  try {
    const workspace = deps.newWorkspace();
    try {
      digests = buildFixtureDigests(workspace);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  } catch {
    say(CHECK_SENTENCES.noWorkspace);
    return { code: 1, lines, report: null };
  }

  const sender = deps.makeSend(facts.route);
  const interpreterRows: InterpreterRow[] = [];
  const curatorRows: CuratorRow[] = [];
  let stopped: string | null = null;
  try {
    if (selected.interpreter) {
      for (let index = 0; index < INTERPRETER_BATTERY.length; index += 1) {
        const row = await runInterpreterRow(
          INTERPRETER_BATTERY[index]!,
          index + 1,
          digests.interpreter,
          sender.send,
          deps.now,
        );
        interpreterRows.push(row);
        say(
          "interpreter " +
            row.index +
            "/" +
            INTERPRETER_BATTERY.length +
            ": " +
            row.outcome +
            " (" +
            row.ms +
            " ms)",
        );
        if (row.outcome === "error" && isAuthRefusal(row.sentence ?? "")) {
          stopped =
            "the run stopped: " +
            (row.sentence ?? "") +
            " — no further calls were made.";
          break;
        }
      }
    }
    if (stopped === null && selected.curator) {
      for (let index = 0; index < CURATOR_BATTERY.length; index += 1) {
        const row = await runCuratorRow(
          CURATOR_BATTERY[index]!,
          index + 1,
          digests.curator,
          sender.send,
          deps.now,
        );
        curatorRows.push(row);
        say(
          "curator " +
            row.index +
            "/" +
            CURATOR_BATTERY.length +
            ": " +
            row.outcome +
            (row.cardChars === null ? "" : " (" + row.cardChars + " chars)") +
            " (" +
            row.ms +
            " ms)",
        );
        if (row.outcome === "error" && isAuthRefusal(row.sentence ?? "")) {
          stopped =
            "the run stopped: " +
            (row.sentence ?? "") +
            " — no further calls were made.";
          break;
        }
      }
    }
  } finally {
    await sender.close();
  }

  const counts = countsOf(interpreterRows, curatorRows);
  const factsForReport: ReportFacts = {
    rowName: facts.rowName,
    rowId: facts.rowId,
    managerModelId: facts.managerModelId,
    taskModelId: facts.taskModelId,
  };
  const reportInput = {
    at,
    facts: factsForReport,
    cap: parsed.maxCalls,
    only: parsed.only,
    interpreterRows,
    curatorRows,
    stopped,
  };
  const markdown = withoutSecret(
    renderReport({ ...reportInput, digests }),
    facts.apiKey,
  );
  const json = withoutSecret(
    renderJson({ ...reportInput, counts }),
    facts.apiKey,
  );
  try {
    mkdirSync(dirname(outMd), { recursive: true });
    writeFileSync(outMd, markdown, "utf8");
    writeFileSync(outJson, json, "utf8");
  } catch {
    say("the report could not be written to " + outMd + ".");
    return { code: 1, lines, report: null };
  }
  say("");
  say(
    "summary: " +
      counts.calls +
      " call(s) made; interpreter acts " +
      counts.interpreter.acts +
      " / question " +
      counts.interpreter.question +
      " / refusal " +
      counts.interpreter.refusal +
      " / error " +
      counts.interpreter.error +
      "; curator card " +
      counts.curator.card +
      " / decline " +
      counts.curator.declined +
      " / unusable " +
      counts.curator.unusable +
      " / error " +
      counts.curator.error +
      ".",
  );
  say("the report: " + outMd);
  if (stopped !== null) say(stopped);
  return {
    code: stopped === null ? 0 : 1,
    lines,
    report: { markdown, json, out: outMd, outJson },
  };
}

/* ------------------------------------------------------------------ *
 * The script's own deps and entry
 * ------------------------------------------------------------------ */

/** The real deps: node's fs, the OS config rule, the sidecar, the clock. */
export function nodeCheckDeps(): ModelCheckDeps {
  const directory = configDirOf(process.env, process.platform);
  return {
    readConfig: () => {
      try {
        return readFileSync(join(directory, "config.json"), "utf8");
      } catch {
        return null;
      }
    },
    readSecrets: () => {
      try {
        return readFileSync(join(directory, "secrets.json"), "utf8");
      } catch {
        return null;
      }
    },
    makeSend: (route) => {
      const node = createNodeTransport();
      return {
        send: (messages) => runRoute(node.transport, route, messages),
        close: node.close,
      };
    },
    now: () => performance.now(),
    newWorkspace: () => mkdtempSync(join(tmpdir(), "attentioneer-check-model-")),
  };
}

/** The CLI entry: print and exit. */
if (import.meta.main) {
  // PRINT AS IT GOES: the plan is on screen before the first call, and each row
  // lands as it ends, because a run that says nothing for minutes reads as a
  // hang (the same rule the command card learnt in story 21.12).
  const result = await runModelCheck(process.argv.slice(2), {
    ...nodeCheckDeps(),
    print: (line) => console.log(line),
  });
  process.exit(result.code);
}
