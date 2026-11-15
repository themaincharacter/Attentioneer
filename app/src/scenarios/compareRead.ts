import { readTextFile } from "../lib/fs";
import type { Assumption } from "../map/assumptions";
import { linksPath, parseLinks, saveLinks, type Link } from "../map/links";
import { modelPath, parseModel, saveModel, type PlayingSet } from "../map/model";
import {
  parseQuantities,
  quantitiesPath,
  saveQuantities,
  type Quantity,
} from "../map/quantities";
import { mapDir, scenarioDir } from "../map/records";
import { parseScenario, scenarioHeaderPath } from "./branch";
import type { CompareModel, ComparisonSource } from "./compare";
import { parsePins, pinsPath } from "./pins";

/**
 * The comparison's READ and the bridge's WRITE (Epic 8 story 4, ADR-0021 §7
 * amended).
 *
 * One seam, because the two are one subject: the COMMITTED model. The
 * comparison reads `map/` and the branch's `scenarios/<slug>/`; the bridge
 * edits `map/` — and only `map/`: `saveCommittedRecord` takes the
 * workspace and joins `map/` itself, so no caller can point an ordinary
 * deliberate edit at a branch folder. A branch is untouched by the return
 * move, which is what makes the branch's evidence (and its run) survive it.
 *
 * The committed records keep their MALFORMED bytes (the no-validation
 * posture): a bridge write re-emits an unreadable line verbatim, exactly as
 * the app's own writers do, and never repairs what the person hand-wrote.
 *
 * The branch side of the reading is loaded from its folder, and a folder
 * without a valid header is NOT a scenario (`branch.ts`'s rule): the read
 * answers null and the app says nothing about a folder it cannot read as a
 * branch. The comparison reads the branch's records only — its pins the dangle
 * predicate; it never writes there.
 *
 * Provisional (ADR-0021): the loader shapes. Nothing here is a record format.
 */

/** The committed model's three variant-owned records, malformed bytes included. */
export interface CommittedRecords {
  /** The playing set, or null when none was accepted. */
  model: PlayingSet | null;
  /** Unreadable `model.json` bytes, preserved for the next write. */
  malformedModel: string | null;
  /** The signed link lines, in file order. */
  links: Link[];
  /** Unreadable `links.jsonl` lines, re-emitted verbatim on a write. */
  malformedLinks: string[];
  /** The quantity lines, in file order. */
  quantities: Quantity[];
  /** Unreadable `quantities.jsonl` lines, re-emitted verbatim on a write. */
  malformedQuantities: string[];
}

/** Which of the three records a bridge edit changed. */
export type CommittedRecord = "model" | "links" | "quantities";

/** Read the committed model's three variant-owned records from `map/`. */
export async function loadCommittedRecords(
  workspacePath: string,
): Promise<CommittedRecords> {
  const dir = mapDir(workspacePath);
  const [model, links, quantities] = await Promise.all([
    readTextFile(modelPath(dir)),
    readTextFile(linksPath(dir)),
    readTextFile(quantitiesPath(dir)),
  ]);
  const parsedModel = parseModel(model);
  const parsedLinks = parseLinks(links ?? "");
  const parsedQuantities = parseQuantities(quantities);
  return {
    model: parsedModel.model,
    malformedModel: parsedModel.malformed,
    links: parsedLinks.links,
    malformedLinks: parsedLinks.malformed,
    quantities: parsedQuantities.quantities,
    malformedQuantities: parsedQuantities.malformed,
  };
}

/**
 * Write ONE committed record — the bridge's write. The path is `map/`'s,
 * joined here, so this door cannot reach a branch folder; the other two
 * records are not touched.
 */
export async function saveCommittedRecord(
  workspacePath: string,
  records: CommittedRecords,
  record: CommittedRecord,
): Promise<void> {
  const dir = mapDir(workspacePath);
  if (record === "model") {
    await saveModel(dir, records.model, records.malformedModel);
    return;
  }
  if (record === "links") {
    await saveLinks(dir, records.links, records.malformedLinks);
    return;
  }
  await saveQuantities(dir, records.quantities, records.malformedQuantities);
}

/** The committed records as the comparison reads them. */
export function committedModelOf(records: CommittedRecords): CompareModel {
  return {
    words: records.model?.words ?? null,
    links: records.links,
    quantities: records.quantities,
  };
}

/**
 * Read one records folder as the comparison reads it. Used for the BRANCH side
 * (its own folder); the committed side comes through `committedModelOf`, so
 * the bridge and the reading never disagree about `map/`.
 */
export async function loadCompareModel(recordsDir: string): Promise<CompareModel> {
  const [model, links, quantities] = await Promise.all([
    readTextFile(modelPath(recordsDir)),
    readTextFile(linksPath(recordsDir)),
    readTextFile(quantitiesPath(recordsDir)),
  ]);
  return {
    words: parseModel(model).model?.words ?? null,
    links: parseLinks(links ?? "").links,
    quantities: parseQuantities(quantities).quantities,
  };
}

/**
 * The comparison's one read: the branch's records and its pins, against the
 * committed records and the committed claims the pins stand on. A folder whose
 * header does not parse as a scenario is not a branch — the read answers null,
 * quietly, and the app shows nothing rather than inventing a reading.
 */
export async function readComparisonSource(
  workspacePath: string,
  slug: string,
  committed: CommittedRecords,
  committedAssumptions: readonly Assumption[],
): Promise<ComparisonSource | null> {
  const dir = scenarioDir(workspacePath, slug);
  const header = parseScenario(await readTextFile(scenarioHeaderPath(dir)));
  if (header === null) return null;
  const [branch, pinsText] = await Promise.all([
    loadCompareModel(dir),
    readTextFile(pinsPath(dir)),
  ]);
  return {
    committed: committedModelOf(committed),
    branch,
    pins: parsePins(pinsText).pins,
    committedAssumptions,
  };
}
