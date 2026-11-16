/**
 * THE SYSTEM OPENER'S URL SCHEMES (Epic 12 story 3) — one vocabulary, two
 * doors. The outward window (Epic 5 story 2) already knew which schemes this
 * build's `opener:default` capability admits; the contact layer's EGRESS
 * (open-os, Ask's handoff) must decide the SAME question before it logs an
 * outcome, so the four schemes and the parsing rule live here, in the lib,
 * apart from any UI. `canvas/outwardRules.ts` re-exports them, so its public
 * API is unchanged and there is one source of truth.
 *
 * The rule is a GUARD, not a policy engine: the capability in
 * `src-tauri/capabilities/default.json` is the authority, and this predicate
 * reads its four allowed URL surfaces (mailto, tel, http, https). Anything
 * else — an unsupported scheme, no scheme at all, a bare path — is refused
 * before the IPC call, so the contact layer never logs a handoff it did not
 * even attempt.
 *
 * Provisional: the scheme list and the parsing rule are the research's
 * `opener:default` facts (Epic 5), carried forward unchanged.
 */

/**
 * The URL schemes `opener:default` already allows in this build (the research's
 * section 1.2: allow-open-url + allow-default-urls with mailto/tel/http/https
 * scopes). Any other scheme is refused by the IPC authority, so the app says
 * so before ever calling it.
 */
export const DEFAULT_URL_SCHEMES = ["http", "https", "mailto", "tel"] as const;

/** The scheme of a url as written, lowercased; null when there is none. */
export function urlScheme(value: string): string | null {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(value);
  return match === null ? null : match[1].toLowerCase();
}

/** Is this url inside opener:default's four scheme surfaces? */
export function schemeAllowed(value: string): boolean {
  const scheme = urlScheme(value);
  return scheme !== null && (DEFAULT_URL_SCHEMES as readonly string[]).includes(scheme);
}
