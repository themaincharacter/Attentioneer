/**
 * THE TEXT'S OWN BYTE SIZE (Epic 12 story 3) — one helper for the two places a
 * contact Move declares a size as a FACT: Make's write-text (the authored
 * text's bytes) and Ask's intake (the response's bytes).
 *
 * It is a DECLARED fact, not a computed one: the bytes of the string the person
 * authored (or pasted) are the string's own size in UTF-8, never a count of
 * something else, never a rounded unit. ADR-0029's amendment says exactly this:
 * content-derived sizes are excluded only from the INCLUSION SET; a write's or a
 * response's size is a legitimate declared fact.
 *
 * Provisional: UTF-8 (the encoding the raw writer and every bridge use).
 */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
