import {
  listDir,
  readTextFile,
  removeDirAll,
  removeFile,
  writeTextFile,
} from "../lib/fs";
import {
  canonicalYaml,
  nextSlug,
  parseYamlFields,
  slugName,
  writeMachineFile,
} from "../lib/serialize";
import { assumptionsPath, parseAssumptions } from "../map/assumptions";
import { linksPath } from "../map/links";
import { modelPath } from "../map/model";
import { mapDir, RECORD_FILE, scenarioDir, scenariosDir } from "../map/records";
import { quantitiesPath } from "../map/quantities";
import {
  PINS_FILE,
  pinsFromAssumptions,
  pinsPath,
  serializePins,
  type ParsedPins,
  parsePins,
} from "./pins";

/**
 * A scenario: a NAMED BRANCH of the dynamics model (ADR-0021, Epic 8 story 2).
 *
 * `scenarios/<slug>/` at the WORKSPACE ROOT — deliberately outside `map/`, so
 * "the map is the committed model" stays literal. The folder is a user-owned
 * area of the workspace, not derived state and not inside `.attentioneer/`;
 * it is not a revision log, a save-state or a history, and nothing in the app
 * enumerates past copies: retirement is DELETING the folder (ammo, no
 * ceremony), and the deletion is the whole of it.
 *
 * A branch folder holds:
 *
 *   - `scenario.yml`  — the self-describing header: the format key and the
 *                       person's coined NAME. It is also the folder's
 *                       PRESENCE SWITCH (see the atomic rule below);
 *   - `model.json`, `links.jsonl`, `quantities.jsonl`
 *                       — BYTE-COPIES of the committed model's three
 *                       variant-owned records, taken when the branch was made
 *                       and edited freely afterwards. They are copies, not
 *                       links: the committed `map/` files are untouched by
 *                       anything done in a branch;
 *   - `assumption-pins.jsonl`
 *                       — ALL the committed assumption lines, pinned
 *                       (`pins.ts`): the claims the branch was made on.
 *
 * ATOMIC + BYTE-FAITHFUL (ADR-0021 decision 1). Byte-faithful means the copies
 * are the committed files' exact bytes — no canonicalization, no repair, no
 * rejected trailing whitespace, no rewritten malformed line. The copies go
 * through `writeTextFile` (the raw byte door), NEVER `writeMachineFile`
 * (which would canonicalize LF and append a trailing newline: that is repair).
 * A file the app cannot read at all (a non-UTF-8 file, which the fs bridge
 * refuses) is not branched: the branch FAILS rather than inventing a plausible
 * copy. An absent committed record copies as absent — a branch of a model with
 * no accepted playing set has no `model.json` either, and its dynamics game is
 * inert in exactly the same way.
 *
 * THE ORDER IS THE ATOMICITY. The header is written LAST, so a folder only
 * becomes a scenario once every copy is on disk: a crash mid-branch leaves a
 * folder with no `scenario.yml`, which is not a scenario (never listed, never
 * resumed), never a plausible half-branch. Retirement mirrors it: the header
 * goes FIRST, so the folder stops being a scenario before anything else is
 * removed; a crash leaves an unlisted leftover folder, never a half-deleted
 * scenario. The header is the folder's one presence bit.
 *
 * Provisional (ADR-0021): the `scenarios/` name, the `scenario.yml` keys
 * (`format`, `name`) and the header-as-commit-point rule. The chooser's look
 * is ADR-0003's rendering seam; the step (story 3) and the comparison (story 4)
 * are not here.
 */

/** The branch header's format key (provisional, ADR-0021). */
export const SCENARIO_FORMAT = "attentioneer-scenario/1";

/** The header's file name — the branch folder's presence switch. */
export const SCENARIO_HEADER = "scenario.yml";

/** One branch as the chooser reads it. */
export interface Scenario {
  /** The folder's name: the coined name's slug (ADR-0005's slug rules). */
  slug: string;
  /** The person's coined name, exactly as the header carries it. */
  name: string;
}

/** The header's path in a branch folder. */
export function scenarioHeaderPath(dir: string): string {
  return `${dir}/${SCENARIO_HEADER}`;
}

/**
 * The header's canonical bytes: the format key and the coined name, one
 * `key: value` per line with sorted keys (`canonicalYaml`).
 */
export function scenarioYml(name: string): string {
  return canonicalYaml({ format: SCENARIO_FORMAT, name });
}

/**
 * Read a header. A folder is a scenario only when its header names THIS app's
 * format key and carries a non-empty name; anything else (a missing header, a
 * foreign or hand-broken one) is not a scenario and is never listed or resumed.
 * Tolerant by design: the app never asks twice and never fails to open.
 */
export function parseScenario(text: string | null): Scenario | null {
  if (text === null) return null;
  const fields = parseYamlFields(text);
  if (fields.format !== SCENARIO_FORMAT) return null;
  const name = typeof fields.name === "string" ? fields.name.trim() : "";
  if (name === "") return null;
  return { slug: slugName(name), name };
}

/** The slug a coined name mints, against the branch folders that already exist. */
export function scenarioSlugFor(
  name: string,
  taken: ReadonlySet<string>,
): string {
  return nextSlug(slugName(name), taken);
}

/**
 * Mint a branch's coin: the name and the slug it becomes, kept in step so the
 * header (which carries the name) and the folder (which carries the slug) can
 * never say different things. A free slug keeps the person's name untouched; a
 * taken one gains the same numeric suffix the slug does — "Evening walk" ->
 * "Evening walk 2" -> `evening-walk-2` — exactly as a loop's coin does
 * (ADR-0005 rule 4, ADR-0012 decision 3). Nothing is silently merged, and two
 * branches never share a name in the chooser.
 */
export function branchName(
  name: string,
  taken: ReadonlySet<string>,
): { slug: string; name: string } {
  const trimmed = name.trim();
  const base = slugName(trimmed);
  const slug = nextSlug(base, taken);
  if (slug === base) return { slug, name: trimmed };
  return { slug, name: `${trimmed} ${slug.slice(base.length + 1)}` };
}

/**
 * What a branch copies: the committed files' EXACT text (`null` when the file
 * is absent) — the three record copies plus the assumptions the pins come from.
 */
export interface BranchSource {
  /** `map/model.json`'s bytes, or null. */
  model: string | null;
  /** `map/links.jsonl`'s bytes, or null. */
  links: string | null;
  /** `map/quantities.jsonl`'s bytes, or null. */
  quantities: string | null;
  /** `map/assumptions.jsonl`'s bytes, or null (the pins' source). */
  assumptions: string | null;
}

/** One file the branch writes: a name inside the folder, and its bytes. */
export interface BranchFile {
  /** The file's name inside `scenarios/<slug>/`. */
  file: string;
  content: string;
}

/**
 * The branch, as the files it is made of and the order they go on disk. Pure:
 * the byte-faithfulness and the header-last rule are asserted without the fs
 * bridge.
 *
 * The copies are verbatim; an absent committed record is absent from the plan
 * (not created empty). The pins are ALWAYS written — a branch of a model with
 * no claims carries the canonical empty document, so "this branch pinned
 * nothing" is a fact on disk rather than a missing file.
 */
export interface BranchPlan {
  /** The copies and the pins, in write order. */
  files: BranchFile[];
  /** The header, written LAST — the commit point. */
  header: BranchFile;
}

export function branchPlan(name: string, source: BranchSource): BranchPlan {
  const files: BranchFile[] = [];
  if (source.model !== null) {
    files.push({ file: RECORD_FILE.model, content: source.model });
  }
  if (source.links !== null) {
    files.push({ file: RECORD_FILE.links, content: source.links });
  }
  if (source.quantities !== null) {
    files.push({ file: RECORD_FILE.quantities, content: source.quantities });
  }
  const pinned = pinsFromAssumptions(
    parseAssumptions(source.assumptions ?? "").assumptions,
  );
  files.push({ file: PINS_FILE, content: serializePins(pinned) });
  return {
    files,
    header: { file: SCENARIO_HEADER, content: scenarioYml(name) },
  };
}

/**
 * Read the committed model's bytes for a branch (raw; a missing file is null).
 * A branch is ALWAYS made from `map/` — the committed model — never from the
 * variant that happens to be running: a scenario is a model variant, not a
 * second model (ADR-0021 decision 6).
 */
export async function readBranchSource(
  workspacePath: string,
): Promise<BranchSource> {
  const dir = mapDir(workspacePath);
  const [model, links, quantities, assumptions] = await Promise.all([
    readTextFile(modelPath(dir)),
    readTextFile(linksPath(dir)),
    readTextFile(quantitiesPath(dir)),
    readTextFile(assumptionsPath(workspacePath)),
  ]);
  return { model, links, quantities, assumptions };
}

/**
 * Branch the committed model: mint the name and the slug, write the copies and
 * the pins in the plan's order, then the header LAST (the commit point). The
 * copies go through the RAW byte door — no canonicalization, ever — and the
 * header through the canonical YAML writer (the app authors it).
 *
 * A crash before the header lands leaves a folder that is not a scenario: it is
 * never listed, never resumed and never adopted as one. The next branch mints
 * against ALL the entries in `scenarios/` (stray folders included), so it
 * cannot quietly take over a half-written folder; the leftover is quiet, and
 * the person can delete it. The header makes a claim only once the whole copy
 * is on disk.
 */
export async function createScenario(
  workspacePath: string,
  name: string,
): Promise<Scenario> {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new Error("a scenario needs a coined name");
  }
  const source = await readBranchSource(workspacePath);
  const taken = new Set(await listDir(scenariosDir(workspacePath)));
  const minted = branchName(trimmed, taken);
  const dir = scenarioDir(workspacePath, minted.slug);
  const plan = branchPlan(minted.name, source);
  for (const file of plan.files) {
    await writeTextFile(`${dir}/${file.file}`, file.content);
  }
  // LAST: the folder becomes a scenario only now.
  await writeMachineFile(
    scenarioHeaderPath(dir),
    plan.header.content,
  );
  return minted;
}

/**
 * Retire a branch: DELETE it (ADR-0021 decisions 1 and 6). Nothing is archived
 * and nothing records that it existed — the folder is the whole of a scenario.
 *
 * The header goes FIRST (the presence switch), then the bytes, then the folder
 * itself: a crash mid-retire leaves an unlisted leftover folder — a folder the
 * chooser never offers and the resume hint never resumes — never a scenario
 * missing half its records. Removing a folder that is already gone is a quiet
 * no-op.
 */
export async function retireScenario(
  workspacePath: string,
  slug: string,
): Promise<void> {
  const dir = scenarioDir(workspacePath, slug);
  await removeFile(scenarioHeaderPath(dir));
  for (const file of [
    RECORD_FILE.model,
    RECORD_FILE.links,
    RECORD_FILE.quantities,
    PINS_FILE,
  ]) {
    await removeFile(`${dir}/${file}`);
  }
  await removeDirAll(dir);
}

/** The branch folders on disk, in slug order (the fs bridge's listing order). */
export function scenarioFolders(workspacePath: string): Promise<string[]> {
  return listDir(scenariosDir(workspacePath));
}

/**
 * The branches the chooser offers: every folder carrying a valid header, in
 * listing (slug) order. A folder without one (a crash leftover, a hand-made
 * directory) is not a scenario and is never invented into one.
 */
export async function listScenarios(
  workspacePath: string,
): Promise<Scenario[]> {
  const slugs = await scenarioFolders(workspacePath);
  const scenarios: Scenario[] = [];
  for (const slug of slugs) {
    const text = await readTextFile(
      scenarioHeaderPath(scenarioDir(workspacePath, slug)),
    );
    const parsed = parseScenario(text);
    // The header carries the coined name; the folder name is the slug the app
    // minted, so the listing is stable even if a hand edit renames the folder.
    if (parsed) scenarios.push({ slug, name: parsed.name });
  }
  return scenarios;
}

/**
 * A branch's pins, read from its folder (missing file = nothing pinned). The
 * DANGLE read's one door: story 4's presentation asks this and the pure
 * predicate in `pins.ts`; nothing in story 2 renders a pin.
 */
export async function readScenarioPins(
  workspacePath: string,
  slug: string,
): Promise<ParsedPins> {
  return parsePins(
    await readTextFile(pinsPath(scenarioDir(workspacePath, slug))),
  );
}
