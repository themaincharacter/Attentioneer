import type { Assumption } from "../map/assumptions";
import type { Mark } from "../map/marks";
import type { Pointer } from "../map/pointers";
import type { Quantity } from "../map/quantities";
import type { Veil } from "../map/veils";
import { projectVeil } from "./projection";
import { pullSiteKey, readPull, type PullReading } from "./reader";

/**
 * THE PULL ASK (Epic 13 story 2) — the ONE handler: the press, and the reader's
 * only caller.
 *
 * The pull ("where am I thin?") is asked, never ambient (ADR-0030 decision 6).
 * This module is the ask's whole seam: it takes the records the app already
 * holds, hands the veils through the projection (so a veil record never reaches
 * the reader, ADR-0030 decision 3), and returns the reading. It is a function
 * of records — no path, no workspace, no bridge, no clock, no state — so the
 * pull WRITES NOTHING (ADR-0030's amendment: no file, no log, no PRISM, no
 * storage). The reading is a value the app holds while the surface is open and
 * drops when it closes; there is nothing here to write to and nowhere to
 * remember anything.
 *
 * THE DOOR IS THE ONLY TRIGGER (ADR-0030 decision 6): this handler is called
 * from the app's one press callback, and the reader is imported nowhere else
 * (story 1's scans are extended to name this module as the one importer). No
 * mount, render, effect, timer or subscription reaches it.
 *
 * ASKING AGAIN IS THE SAME RECORD SET. The reading has no cursor, no order and
 * no count: "pullRecordSet" answers its identity as a SET (story 1's
 * "pullSiteKey" per site), so "ask again" is compared as the same records,
 * never as a sequence or a delta. Closing and re-asking is the whole cycle —
 * there is no dismissal state and no suppression list to consult.
 *
 * THE SELECTION IS SAID by the reading itself ("said", ADR-0030 decision 2);
 * the surface shows the records' own words under it and adds nothing.
 *
 * Provisional (ADR-0003's seam): this module being "the pull ask" in code (the
 * contacts' Ask owns its own phrase, and the pull never borrows it), the source
 * shape (the records and the pins in, one reading out) and the set-identity
 * helper. Levels are untouched: an ask reads, it does not change the game.
 */
export interface PullAskSource {
  /** Every mark line (the app's live state). */
  marks: readonly Mark[];
  /** Every claim line (the committed map's). */
  assumptions: readonly Assumption[];
  /** Every quantity line. */
  quantities: readonly Quantity[];
  /** Every pointer line. */
  pointers: readonly Pointer[];
  /** Every veil record — projected here, never handed to the reader. */
  veils: readonly Veil[];
  /**
   * The running branch's pin lines. The committed model pins nothing, so
   * "no branch" is no pins — the record's own absence, never an invented one.
   */
  pins: readonly Assumption[];
}

/**
 * THE PULL ASK: the press calls this and gets the reading back. The veils are
 * projected here (area, name, location only), the branch's pins ride as the
 * records they are, and everything else is the reader's walk of the read set.
 */
export function askPull(source: PullAskSource): PullReading {
  return readPull({
    marks: source.marks,
    assumptions: source.assumptions,
    quantities: source.quantities,
    pointers: source.pointers,
    pins: source.pins,
    veils: source.veils.map(projectVeil),
  });
}

/**
 * The reading's record SET, as identities: story 1's "pullSiteKey" per site,
 * collected into a set. Two asks over the same records answer the same set —
 * the comparison "ask again" is made of — and never a sequence, a delta or a
 * count of what changed. The reading's walk order is not an identity: the same
 * records handed in a different order make the same set.
 */
export function pullRecordSet(reading: PullReading): ReadonlySet<string> {
  return new Set(reading.sites.map(pullSiteKey));
}

/**
 * The reading's own types, re-exported for the surface: the rendering side
 * (canvas/pullRules.ts and the panel) reads the reading's SHAPE from here, so
 * the reader keeps exactly one importer (the scans hold that line).
 */
export type {
  PullAreaSite,
  PullReading,
  PullRecordFamily,
  PullRecordSite,
  PullSite,
  PullSiteAnchor,
  PullVeilSite,
} from "./reader";
