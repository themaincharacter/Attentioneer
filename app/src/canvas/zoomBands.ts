/**
 * Which content shows at which zoom band (ADR-0003). Provisional: these
 * thresholds become language games at Epic 6 and are not settled by any ADR.
 */

/** Below this zoom a working note collapses to its title. */
export const COLLAPSE_BELOW = 0.55;

export type NoteBand = "title" | "full";

export function noteBand(zoom: number): NoteBand {
  return zoom < COLLAPSE_BELOW ? "title" : "full";
}
