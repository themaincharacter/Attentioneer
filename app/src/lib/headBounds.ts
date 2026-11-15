/**
 * The window's bounds contract (Epic 5 story 2, ADR-0017's amendment): a glimpse
 * is SMALL by construction, not by rendering preference.
 *
 * The bridge enforces the bounds where the read happens (BufReader prefix read,
 * byte cap short-circuit, char-boundary-safe cut — see
 * `app/src-tauri/src/head.rs`); this module owns the SAME bounds on the display
 * side. The duplicate rule is deliberate belt-and-braces: the window never
 * trusts an unbounded string across the IPC bridge (an older build, another
 * machine's bridge, a hand-edited result), and a pure module is where bun can
 * assert the byte cap and the char-boundary promise without a DOM or Rust.
 *
 * Provisional: the numbers themselves (the story's "glimpse bounds" seam).
 */

/**
 * How many lines a glimpse asks for (provisional). Small on purpose: the
 * window never scrolls, so a bound larger than the card can show would fetch
 * text nobody can ever read.
 */
export const HEAD_MAX_LINES = 20;

/**
 * How many UTF-8 bytes a glimpse asks for (provisional). Sized to the card:
 * a long single line (code, minified JSON) is cut here, and the window's own
 * overflow note keeps the display honest when wrapping still hides a tail.
 */
export const HEAD_MAX_BYTES = 1600;

/** What a bounded head is: the text plus "there is more". */
export interface BoundedHead {
  head: string;
  truncated: boolean;
}

/**
 * Cut a text to at most `maxLines` lines, then to at most `maxBytes` UTF-8
 * bytes, never splitting a code point. `truncated` is true when either bound
 * removed something — the window says "truncated" plainly, never a count.
 *
 * The byte cut is done on UTF-8 bytes and decoded with a streaming decoder, so
 * an incomplete trailing sequence is withheld rather than turned into U+FFFD.
 */
export function clipHead(
  text: string,
  maxLines: number = HEAD_MAX_LINES,
  maxBytes: number = HEAD_MAX_BYTES,
): BoundedHead {
  const lines = clipLines(text, maxLines);
  const bytes = new TextEncoder().encode(lines.head);
  if (bytes.length <= maxBytes) {
    return { head: lines.head, truncated: lines.truncated };
  }
  const cut = bytes.slice(0, Math.max(0, maxBytes));
  return {
    head: new TextDecoder("utf-8", { fatal: false }).decode(cut, { stream: true }),
    truncated: true,
  };
}

/** Cut after the `maxLines`-th newline when more text follows (pure). */
export function clipLines(
  text: string,
  maxLines: number,
): BoundedHead {
  if (maxLines <= 0) {
    return { head: "", truncated: text !== "" };
  }
  let seen = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 10) continue;
    seen += 1;
    if (seen !== maxLines) continue;
    const cut = index + 1;
    return cut < text.length
      ? { head: text.slice(0, cut), truncated: true }
      : { head: text, truncated: false };
  }
  return { head: text, truncated: false };
}
