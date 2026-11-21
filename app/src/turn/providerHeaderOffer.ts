/**
 * A ROW THAT NEVER LEARNED ITS DOCUMENTED HEADER (Epic 23 story 4; PROVISIONAL).
 *
 * WHY THIS EXISTS: the catalogue ships a documented request header for an
 * endpoint that needs one, and the picker hands it to a NEW row. A row added
 * before that existed — or typed by hand — keeps working on the generic
 * x-session-id compatibility and never learns it could carry the documented
 * name. This module is how the panel NOTICES that, without knowing any vendor:
 * the row's base URL is compared to the catalogue's own `api`, and a match
 * brings that entry's documented header map, as data.
 *
 * DETECTION IS BY DATA, AND IT IS ONLY A QUESTION. Nothing here writes a row:
 * an offer is a sentence and a press, and the press goes through the existing
 * editor path (validateProviderRow, then the one queued config write). A row is
 * the person's; an unasked edit to their configuration is what this app
 * refuses.
 *
 * NO DUPLICATE, NO CLOBBER: a name the row already carries — in ANY casing — is
 * not offered again; when its value differs from the catalogue's, it is
 * CONFLICTING and is only said, never changed. The value is never put in a
 * sentence: the catalogue's value is the generic session placeholder, but a
 * value may be the person's own and a sentence is shown on screen.
 *
 * RESERVED NAMES ARE NEVER OFFERED, even if a catalogue entry carried one:
 * requestHeaders.ts already refuses them at the write and at the wire, and this
 * is the third, quiet place the rule holds.
 *
 * PROVISIONAL: the sentence wording, the normalisation, and where the line
 * sits. Nothing here is a record field.
 */

import {
  isReservedHeaderName,
  readRequestHeaders,
} from "./requestHeaders";
import {
  PROVIDER_CATALOG,
  type ProviderCatalogEntry,
} from "./providerCatalog";
import type { HttpProviderRow, ProviderRow } from "./providers";

/** What one matching endpoint documents that its row does not carry. */
export interface DocumentedHeaderOffer {
  /** The catalogue entry the row's endpoint names. */
  entryId: string;
  /** Documented names the row carries nowhere: the press may add them. */
  add: readonly string[];
  /** Documented names the row carries with another value: said, not changed. */
  conflicts: readonly string[];
}

/**
 * ONE ENDPOINT'S IDENTITY, normalised: trimmed, trailing slashes ignored, and
 * the scheme and host case-folded by the URL parser. The path keeps its case
 * (a path is case-sensitive), so two URLs that name different resources do not
 * become one. An unparseable URL falls back to the trimmed, lower-cased text:
 * it matches nothing in the catalogue anyway, and the panel still gets a
 * decision rather than an exception.
 */
export function normalizedEndpoint(text: string): string {
  const trimmed = text.trim();
  try {
    const url = new URL(trimmed);
    const path = url.pathname.replace(/\/+$/, "");
    const port = url.port === "" ? "" : ":" + url.port;
    return url.protocol + "//" + url.hostname.toLowerCase() + port + path;
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}

/** The catalogue entry a row's endpoint names, by the normalised URL. */
function entryForEndpoint(
  baseUrl: string,
  catalog: readonly ProviderCatalogEntry[],
): ProviderCatalogEntry | null {
  const wanted = normalizedEndpoint(baseUrl);
  return (
    catalog.find((entry) => normalizedEndpoint(entry.baseUrl) === wanted) ?? null
  );
}

/**
 * WHAT THIS ROW COULD BE TOLD (pure). A row that is not an endpoint, a URL no
 * catalogue entry lists, an entry with no documented header, and a row that
 * already carries every documented name all answer `null` — the panel shows
 * NOTHING rather than an empty line. Otherwise the answer names the headers
 * only, split into what a press may add and what is a conflict to say.
 */
export function documentedHeaderOffer(
  row: ProviderRow,
  catalog: readonly ProviderCatalogEntry[] = PROVIDER_CATALOG,
): DocumentedHeaderOffer | null {
  if (row.kind !== "http") return null;
  const entry = entryForEndpoint(row.baseUrl, catalog);
  if (entry === null || entry.headers === undefined) return null;

  const carried = new Map<string, string>();
  for (const [name, value] of Object.entries(
    readRequestHeaders(row.headers ?? {}),
  )) {
    carried.set(name.trim().toLowerCase(), value);
  }

  const add: string[] = [];
  const conflicts: string[] = [];
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(entry.headers)) {
    const lowered = name.trim().toLowerCase();
    if (lowered === "" || seen.has(lowered)) continue;
    seen.add(lowered);
    // Defence in depth: the catalogue is data, and data may be wrong.
    if (isReservedHeaderName(name)) continue;
    if (!carried.has(lowered)) {
      add.push(name);
    } else if (carried.get(lowered) !== value) {
      conflicts.push(name);
    }
  }
  if (add.length === 0 && conflicts.length === 0) return null;
  return { entryId: entry.id, add, conflicts };
}

/**
 * THE ROW A PRESS WOULD WRITE (pure, not yet validated). Only the names the
 * offer said may be added are added, only from the entry's own data, and only
 * when the row does not carry that name in any casing — so a stale offer or a
 * hand-edited row cannot clobber a value. Validation is still the editor's, one
 * call away.
 */
export function withDocumentedHeaders(
  row: HttpProviderRow,
  names: readonly string[],
  catalog: readonly ProviderCatalogEntry[] = PROVIDER_CATALOG,
): HttpProviderRow {
  const headers: Record<string, string> = {
    ...readRequestHeaders(row.headers ?? {}),
  };
  const wanted = new Set(names.map((name) => name.trim().toLowerCase()));
  const carried = new Set(
    Object.keys(headers).map((name) => name.trim().toLowerCase()),
  );
  const entry = entryForEndpoint(row.baseUrl, catalog);
  if (entry !== undefined && entry !== null && entry.headers !== undefined) {
    for (const [name, value] of Object.entries(entry.headers)) {
      const lowered = name.trim().toLowerCase();
      if (!wanted.has(lowered)) continue;
      if (carried.has(lowered)) continue;
      if (isReservedHeaderName(name)) continue;
      headers[name] = value;
      carried.add(lowered);
    }
  }
  const next: HttpProviderRow = { ...row };
  if (Object.keys(headers).length > 0) next.headers = headers;
  return next;
}

/**
 * WHAT THE PANEL SAYS (PROVISIONAL wording). The header's NAME is data and is
 * named; its VALUE never is. The conflict sentence's last clause is the rule
 * itself: the row is left as the person has it.
 */
export const HEADER_OFFER_SENTENCES = {
  missing: (name: string) =>
    "this endpoint documents the request header " +
    name +
    ", and this row does not carry it",
  conflict: (name: string) =>
    "this endpoint documents the request header " +
    name +
    ", but this row names it with a different value — left as it is",
  add: "add it",
} as const;
