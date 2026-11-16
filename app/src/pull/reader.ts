import { canonicalJson } from "../lib/serialize";
import {
  serializeAssumptionLine,
  type Assumption,
  type AssumptionTarget,
} from "../map/assumptions";
import { serializeMarkLine, type Mark, type MarkTarget } from "../map/marks";
import {
  serializePointerLine,
  type Pointer,
  type PointerForm,
} from "../map/pointers";
import { serializeQuantityLine, type Quantity } from "../map/quantities";
import { committedAssumptionKeys, pinDangles } from "../scenarios/pins";
import type { VeilProjection } from "./projection";

/**
 * THE READER (ADR-0030; Epic 13 story 1) — the pull's read-set walker.
 *
 * The pull ("where am I thin?") is a mechanical reading that shows each record
 * AT ITS OWN SITE: the relation is the record's own anchor identity (a word,
 * a wire, a wordless pair, a spot, a pointer line, a loop, a veil's box), never
 * a per-part list. This module is the walk: it is handed the workspace's
 * records and returns them one by one, each with the three things a reading
 * needs — its family (the record's own grammar), its site (the anchor the
 * record itself names) and ITS OWN WORDS as provenance.
 *
 * THE RECORDS ARE THE EXPLANATION. Each record's words are its canonical line
 * (`serialize.ts` is the byte door, ADR-0004): the mark's fields (the wordless
 * pair's `from`/`to`, the pointer-target form's `on` + form + value), the
 * claim's text and target, the amount line (an absent amount stays ABSENT —
 * the line says unknown by saying nothing), the pointer's authored form and
 * value, the pin's claim. Nothing is derived, paraphrased, tidied or
 * interpreted here (World B): the module composes no sentence about a record
 * and makes none for the person.
 *
 * CO-PRESENCE, NEVER ARRANGEMENT. `sites` is ONE collection: it is never
 * nested by part, never sorted, never ranked, merged, weighted or sized. Two
 * claims on one word are two entries standing at the same site; the walker
 * does not pair them up or put them side by side — that the two speak to each
 * other is the person's reading, not the module's. The walk visits the read
 * set family by family; that order is the walk, never a salience verdict.
 *
 * THE SELECTION IS SAID. `said` opens every reading with the sentence below:
 * this speaks where records exist, and where none does, that is silence, not
 * safety. The reading never directs (no "you", no "should") and never claims a
 * part is settled because it is quiet.
 *
 * THE READ SET IS THE RECORDS THAT EXIST (ADR-0030 decision 5): marks;
 * assumptions; quantities; pointers; scenario pins — including DANGLING pins,
 * which keep their claim and carry the drop-rule sentence; and veils, which
 * arrive ONLY as the projection's fields (area, name, location) — a veil record
 * is not in this module's types, and what a veil sits over is never read. No
 * family is invented here to feed the pull: a malformed line is not a record
 * and so not a site (the app's notices surface it), and a known record's
 * unknown keys ride inside its own line, exactly as the file keeps them.
 *
 * A POINTER'S TARGET IS NEVER CHECKED. Whether a path, an absolute path or a
 * URL still resolves is the world's business, and the pull reads no world (that
 * is the contacts' job): a pointer shows its own line and nothing more, with no
 * rule sentence. The pin's dangle is the one standing test the records
 * themselves make — its ground is in the map's own assumptions file.
 *
 * READ-ONLY, STRUCTURALLY. The reader imports no filesystem bridge and takes no
 * paths: it is handed records and returns a value. The pull therefore writes
 * NOTHING — no file, no log, no storage — and mints no log line, because there
 * is no writer within reach and no address to write to. The reading is
 * ephemeral (dismissal is deletion, ADR-0030 decision 4).
 *
 * NO AMBIENT TRIGGER. This module exposes no door, no timer, no subscription
 * and no mount: it is a function of records, called by the pull's ask handler
 * (story 2) and by nothing on a render path. The named scans in
 * `tests/pull-scans.test.ts` hold that line.
 *
 * Provisional (ADR-0003's seam): the module's home in `pull/`, the reading's
 * shape (`said` + `sites`), the family names, the anchor forms' spelling, the
 * drop-rule sentence's wording, and the walk order. Levels are untouched: the
 * reading reads, it does not change the game.
 */

/** The selection sentence, verbatim (ADR-0030 decision 2) — part of every reading. */
export const PULL_SELECTION =
  "this speaks where records exist; the rest is silence, not safety.";

/**
 * The drop-rule sentence a dangling pin carries (the check's words). A pin
 * stands on an exact claim — the same words on the same target — and the record
 * module owns that predicate (`pinDangles`). The sentence states the rule, not
 * a verdict: it never says which of the ways the ground went, and it never
 * tells the person what it means.
 */
export const DANGLING_PIN_NOTE =
  "a pin stands on an exact claim; when the map's assumptions no longer carry the same words on the same target, the pin is kept and shown as it stands, and nothing is repaired.";

/**
 * Where a record stands — the anchor it names on the map. The forms mirror the
 * record families' own target grammars (a mark's word/wire/pair/spot/pointer
 * line, a claim's word/pair/loop/spot, a stock's word, a flow's pair, a veil's
 * box), so a site is the record's own address and never a derived place.
 */
export type PullSiteAnchor =
  | { type: "word"; slug: string }
  | { type: "wire"; from: string; to: string; word: string }
  | { type: "link"; from: string; to: string }
  | { type: "flow"; from: string; to: string }
  | { type: "spot"; x: number; y: number }
  | { type: "pointer"; on: string; form: PointerForm; value: string }
  | { type: "loop"; slug: string }
  | { type: "area"; x: number; y: number; w: number; h: number };

/** A veil's own site: the box the projection hands over (and nothing else). */
export type PullAreaSite = Extract<PullSiteAnchor, { type: "area" }>;

/** The record families the reader walks (a veil is its own, projected case). */
export type PullRecordFamily =
  | "mark"
  | "assumption"
  | "quantity"
  | "pointer"
  | "pin";

/** One record at its own site, with its own words as provenance. */
export interface PullRecordSite {
  /** The record's family — its own grammar, not a grouping of sites. */
  family: PullRecordFamily;
  /** The anchor the record itself names (its own address on the map). */
  site: PullSiteAnchor;
  /** The record's own line, verbatim (its canonical bytes; never paraphrased). */
  words: string;
  /** A standing rule sentence the record itself requires (a dangling pin's). */
  note: string | null;
}

/** A veil at its site: only the projection's fields exist here. */
export interface PullVeilSite {
  family: "veil";
  /** The box — the veil's own site, its only geometry. */
  site: PullAreaSite;
  /** The person's coined name, verbatim. */
  name: string;
  /** The location string as the projection hands it, or null. */
  location: string | null;
}

export type PullSite = PullRecordSite | PullVeilSite;

/**
 * What the reader is handed: the workspace's records as the app already reads
 * them, and nothing else. Veils arrive projected (`VeilProjection`), so a veil
 * record never reaches this module. No paths, no workspace, no filesystem:
 * there is nothing here to write to.
 */
export interface PullRecords {
  /** Every mark line. */
  marks: readonly Mark[];
  /** Every claim line (the committed map's). */
  assumptions: readonly Assumption[];
  /** Every quantity line. */
  quantities: readonly Quantity[];
  /** Every pointer line. */
  pointers: readonly Pointer[];
  /** Every scenario pin line (a branch's). */
  pins: readonly Assumption[];
  /** Every veil, as the projection hands it. */
  veils: readonly VeilProjection[];
}

/** The reading: the selection, SAID, and the sites as co-presence. */
export interface PullReading {
  /** The selection sentence, verbatim (ADR-0030 decision 2). */
  said: string;
  /** Each read-set record at its own site — one collection, never arranged. */
  sites: readonly PullSite[];
}

/** The site a mark's own target names. */
function siteOfMarkTarget(target: MarkTarget): PullSiteAnchor {
  switch (target.type) {
    case "word":
      return { type: "word", slug: target.slug };
    case "wire":
      return {
        type: "wire",
        from: target.from,
        to: target.to,
        word: target.word,
      };
    case "link":
      return { type: "link", from: target.from, to: target.to };
    case "spot":
      return { type: "spot", x: target.x, y: target.y };
    case "pointer":
      return {
        type: "pointer",
        on: target.on,
        form: target.form,
        value: target.value,
      };
  }
}

/** The site a claim's (or a pin's) own target names. */
function siteOfAssumptionTarget(target: AssumptionTarget): PullSiteAnchor {
  switch (target.type) {
    case "word":
      return { type: "word", slug: target.slug };
    case "link":
      return { type: "link", from: target.from, to: target.to };
    case "loop":
      return { type: "loop", slug: target.slug };
    case "spot":
      return { type: "spot", x: target.x, y: target.y };
  }
}

/**
 * The site a quantity line names: a stock sits on its word, a flow on its
 * ordered pair (its own pair shape — a flow is not a link).
 */
function siteOfQuantity(quantity: Quantity): PullSiteAnchor {
  return quantity.type === "stock"
    ? { type: "word", slug: quantity.on }
    : { type: "flow", from: quantity.from, to: quantity.to };
}

/**
 * THE WALK. Hand in the workspace's records, get back the selection and every
 * read-set record at its own site. Pure and read-only: it has no I/O, no
 * clock, no ambient input and no state — the same records always make the same
 * reading. Dangling pins are the record module's predicate (`pinDangles`),
 * imported rather than re-derived, and they keep their claim with the rule
 * sentence attached; every other site's `note` is null.
 */
export function readPull(records: PullRecords): PullReading {
  const sites: PullSite[] = [];

  for (const mark of records.marks) {
    sites.push({
      family: "mark",
      site: siteOfMarkTarget(mark.target),
      words: serializeMarkLine(mark),
      note: null,
    });
  }

  for (const assumption of records.assumptions) {
    sites.push({
      family: "assumption",
      site: siteOfAssumptionTarget(assumption.target),
      words: serializeAssumptionLine(assumption),
      note: null,
    });
  }

  for (const quantity of records.quantities) {
    sites.push({
      family: "quantity",
      site: siteOfQuantity(quantity),
      words: serializeQuantityLine(quantity),
      note: null,
    });
  }

  for (const pointer of records.pointers) {
    sites.push({
      family: "pointer",
      site: {
        type: "pointer",
        on: pointer.on,
        form: pointer.form,
        value: pointer.value,
      },
      words: serializePointerLine(pointer),
      note: null,
    });
  }

  const committed = committedAssumptionKeys(records.assumptions);
  for (const pin of records.pins) {
    sites.push({
      family: "pin",
      site: siteOfAssumptionTarget(pin.target),
      words: serializeAssumptionLine(pin),
      note: pinDangles(pin, committed) ? DANGLING_PIN_NOTE : null,
    });
  }

  for (const veil of records.veils) {
    sites.push({
      family: "veil",
      site: {
        type: "area",
        x: veil.area.x,
        y: veil.area.y,
        w: veil.area.w,
        h: veil.area.h,
      },
      name: veil.name,
      location: veil.location,
    });
  }

  return { said: PULL_SELECTION, sites };
}

/**
 * A site's identity for SET comparison (story 2's "the same record set
 * returns"): the site's canonical bytes. An identity, never a position — the
 * reading has no sequence to index.
 */
export function pullSiteKey(site: PullSite): string {
  return canonicalJson(site);
}
