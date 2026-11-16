import type { Veil } from "../map/veils";

/**
 * THE VEIL PROJECTION (ADR-0023 decision 4, ADR-0030 decision 3; Epic 13
 * story 1). The pull may read a veil's PRESENCE, NAME and LOCATION — never its
 * prose and never what it covers. This module is the one place a veil record
 * becomes something the pull can hold: it turns the four box numbers and the
 * coined name into a `VeilProjection`, and that type HAS NO FIELD FOR ANYTHING
 * ELSE.
 *
 * STRUCTURAL, not filtered (the seam's own words): the reader never imports
 * `map/veils.ts`, so a veil record is not in the reader's types at all — and a
 * raw record cannot be handed to the reader, because the reader's shape names
 * an `area` the record does not have (x/y/w/h are the record's; `area` is the
 * projection's). What a veil covers is never computed, enumerated or looked
 * up: the cover rule is not imported here. This is the same drop the packet
 * performs for the ghost layer (`veilPlacementOf`, ADR-0026), kept separate
 * because the pull must not import the packet.
 *
 * Provisional (ADR-0003's rendering seam): the module's home in `pull/`, the
 * `location` string's spelling ("x …, y …, w …, h …" — the packet's own
 * spelling), and the location being nullable so a caller with no string to give
 * still hands a projection (the reading then shows the area and the name
 * alone). The veil's own record is unchanged; this is a reading, not a rewrite.
 */
export interface VeilProjection {
  /** The box the veil covers — the ONLY geometry the pull holds. */
  area: { x: number; y: number; w: number; h: number };
  /** The person's coined name, verbatim. */
  name: string;
  /** The location as one string, verbatim; null when the caller has none. */
  location: string | null;
}

/**
 * Project one veil record to what the pull may hold: its area (the box's four
 * numbers, exactly as the record states them), its name and its location
 * string. The record's prose is not read — the projection has nowhere to put
 * it — and nothing the veil covers is consulted.
 */
export function projectVeil(veil: Veil): VeilProjection {
  return {
    area: { x: veil.x, y: veil.y, w: veil.w, h: veil.h },
    name: veil.name,
    location: `x ${veil.x}, y ${veil.y}, w ${veil.w}, h ${veil.h}`,
  };
}
