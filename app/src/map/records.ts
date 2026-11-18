/**
 * Where the variant-owned records live (ADR-0021, Epic 8 story 2).
 *
 * The map is the COMMITTED MODEL, and that stays literal: `map/references/`,
 * `map/distances.jsonl`, `map/marks.jsonl`, `map/loops.jsonl`,
 * `map/assumptions.jsonl`, `map/pointers.jsonl` and `map/veils.jsonl` are the
 * person's one model and never move. But three of the map's records are the dynamics MODEL's
 * records — the playing set (`model.json`), the signed links
 * (`links.jsonl`) and the authored quantities (`quantities.jsonl`) — and a
 * branch (a scenario, ADR-0021 decision 1) carries byte-copies of exactly
 * those three into `scenarios/<slug>/`. While a branch is active they are the
 * records the app reads and writes; the committed copies are untouched.
 *
 * So the three records have a FOLDER, not a fixed path: `map/` for the
 * committed model, `scenarios/<slug>/` for a branch. Every other map record —
 * the veils included (Epic 9 story 1, ADR-0023) — has a FIXED path in `map/`
 * and is never copied into a branch: a veil is spatial, so a branch's model
 * variant does not change which area of the plane is covered, and a branch can
 * neither add nor retire one. This module owns that
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

/**
 * The GROUND map's OWN record files (story 16.1). They are deliberately NOT in
 * `RECORD_FILE`: that table is the three variant-owned dynamics records a
 * branch copies, while ground is its own map with its own truth and no
 * branches. Both live in `map/` always and are never copied anywhere, so the
 * workspace's `map/` folder alone rebuilds the ground view.
 *
 * PROVISIONAL (the story's record shapes, before an ADR): a line-oriented text
 * file each, deduped by the slug spine. Story 1 writes one file per family; a
 * later story may make the reading's cap/staleness honest, not these names.
 */
export const GROUND_RECORD_FILE = {
  /** One line per grounded reference: `on | name | x | y`. */
  ground: "ground.txt",
  /** One line per reading, keyed to the same slug as its reference. */
  readings: "readings.txt",
  /**
   * One line per WORDLESS ground link (story 16.5): `from | to`, an ordered
   * pair of reference slugs and nothing else. Provisional with the rest.
   */
  links: "ground-links.txt",
} as const;

/**
 * THE ASK CARD'S OWN RECORD (Epic 17 story 1). It is a NEW family beside the
 * ground records, not a reading: one `map/asks.txt` line per ask card and one
 * conversation file per card under `map/asks/`. PROVISIONAL with the rest —
 * the names, the line shape and the folder may move when an ADR settles them.
 * Kept out of `GROUND_RECORD_FILE` because an ask card is not a ground
 * reference and has no reading, note, media or link of its own.
 */
export const ASK_RECORD_FILE = {
  /** One line per ask card: `on | name | x | y | anchor`. */
  asks: "asks.txt",
} as const;

/**
 * The ask cards' conversation folder, beside `map/asks.txt`: one
 * `<slug>.jsonl` per card, one turn per line. Story 17.1 writes exactly one
 * exchange; 17.2 reads the same shape as a thread, so no migration is needed.
 */
export const ASK_TURNS_DIR = "asks";

/**
 * THE SESSION CARD'S OWN RECORD (Epic 18 story 3). A THIRD family beside the
 * ground references and the ask cards, and not a reading either: one
 * `map/sessions.txt` line per session card and one transcript per card under
 * `map/sessions/`. PROVISIONAL with the rest — the names, the line shape and
 * the folder may move when an ADR settles them. Kept out of `GROUND_RECORD_FILE`
 * and `ASK_RECORD_FILE` because a session card has no reading, no anchor and no
 * conversation of its own: it binds a TOOL ROW and holds that row's run.
 */
export const SESSION_RECORD_FILE = {
  /** One line per session card: `on | name | x | y | tool`. */
  sessions: "sessions.txt",
} as const;

/**
 * The session transcripts' folder, beside `map/sessions.txt`: one
 * `<slug>.jsonl` per card, one progress entry per line, in arrival order.
 * APPEND-ONLY: an earlier line's bytes are a prefix that never changes.
 */
export const SESSION_TRANSCRIPTS_DIR = "sessions";

/**
 * The ground readings' text folder, beside `map/readings.txt`: one
 * `<slug>.md` per reading, holding the file's opening lines as read. The
 * name is provisional with the record shape; it is the one folder the ground
 * map writes besides its two files.
 */
export const GROUND_READINGS_DIR = "readings";

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
 * The records folder's WORKSPACE-RELATIVE spelling — `map` for the committed
 * model, `scenarios/<slug>` for a branch (Epic 10 story 1: the ghost envelope's
 * base pin names the folder without binding the proposal to one machine's
 * workspace path). The one source of the arithmetic, so a caller never
 * hand-joins a record path and the relative and absolute forms cannot drift.
 */
export function recordsRelDirOf(scenario: string | null): string {
  return scenario === null ? MAP_DIR : `${SCENARIOS_DIR}/${scenario}`;
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
  return `${workspacePath}/${recordsRelDirOf(scenario)}`;
}
