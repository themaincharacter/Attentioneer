/**
 * Where the variant-owned records live (ADR-0021, Epic 8 story 2).
 *
 * The map is the COMMITTED MODEL, and that stays literal: `map/references/`,
 * `map/distances.jsonl`, `map/marks.jsonl`, `map/loops.jsonl`,
 * `map/assumptions.jsonl` and `map/pointers.jsonl` are the person's one model
 * and never move. But three of the map's records are the dynamics MODEL's
 * records — the playing set (`model.json`), the signed links
 * (`links.jsonl`) and the authored quantities (`quantities.jsonl`) — and a
 * branch (a scenario, ADR-0021 decision 1) carries byte-copies of exactly
 * those three into `scenarios/<slug>/`. While a branch is active they are the
 * records the app reads and writes; the committed copies are untouched.
 *
 * So the three records have a FOLDER, not a fixed path: `map/` for the
 * committed model, `scenarios/<slug>/` for a branch. This module owns that
 * one piece of arithmetic so no caller hand-joins a record path, and so the
 * chooser, the branch writer and the atomic batches all agree on where a
 * branch lives.
 *
 * Provisional (ADR-0021): the `scenarios/` folder name and the
 * `<slug>/` shape. A scenario's folder is a user-owned area of the workspace,
 * not derived state and not inside `.attentioneer/`.
 */

/** The committed map's own folder (the person's model). */
export const MAP_DIR = "map";

/** The branches' folder at the workspace root (outside `map/`). */
export const SCENARIOS_DIR = "scenarios";

/** The three files a branch carries for the model (and the committed model holds). */
export const RECORD_FILE = {
  /** The playing set: `{"words": [...]}`. */
  model: "model.json",
  /** One line per signed causal link. */
  links: "links.jsonl",
  /** One line per authored amount. */
  quantities: "quantities.jsonl",
} as const;

/** The committed model's records folder. */
export function mapDir(workspacePath: string): string {
  return `${workspacePath}/${MAP_DIR}`;
}

/** The branches' folder. */
export function scenariosDir(workspacePath: string): string {
  return `${workspacePath}/${SCENARIOS_DIR}`;
}

/** One branch's folder. */
export function scenarioDir(workspacePath: string, slug: string): string {
  return `${scenariosDir(workspacePath)}/${slug}`;
}

/**
 * The records folder the three variant-owned records live in right now:
 * `map/` for the committed model (`scenario === null`), the branch's folder
 * otherwise. The app asks this once per load; every record load and save takes
 * the folder it returns.
 */
export function recordsDirOf(
  workspacePath: string,
  scenario: string | null,
): string {
  return scenario === null
    ? mapDir(workspacePath)
    : scenarioDir(workspacePath, scenario);
}
