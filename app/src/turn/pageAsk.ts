import type { AskPacketCard, AskPacketPage } from "./packet";
import type { PageTextAnswer } from "./pageFetch";

/**
 * THE ASK'S PAGE READS (story 16.26) — the small, pure-but-for-its-fetcher
 * step between the wired cards and the packet: every wired PAGE card is opened
 * ONCE when the question is assembled, and what came back is attached to that
 * card's block facts. Nothing here renders and nothing here writes a record.
 *
 * WHY HERE AND NOT IN THE CARD. The user's ruling was "just need a simple page
 * thumbnail or something in the card; the llm can open the page and crawl it."
 * So the card keeps no transcript and the packet asks for the page at the one
 * moment a reader exists: send time. The card's own copy (title, thumbnail,
 * host) still renders offline — 16.14's rule, kept.
 *
 * ONE READ PER CARD, PER ASK. The card's address is read once for this ask and
 * never again for this ask: no retry, no per-turn re-read of a thread, and a
 * list with the same card twice still asks once. A read that fails becomes the
 * block's one citation sentence; the send goes ahead with the page's absence
 * said rather than hidden.
 *
 * PURE APART FROM THE FETCHER IT IS HANDED: the sources come from the packet
 * cards, the fetcher is the window's existing page seam, so bun can prove the
 * block without a window and the hook can prove it without a model.
 */

/** What the ask needs from the window: one page's text, or one sentence. */
export type AskPageFetch = (url: string) => Promise<PageTextAnswer>;

/** One page card the ask must open, and the address it is a page at. */
export interface AskPageSource {
  /** The card's slug, so the read goes back onto the same card. */
  on: string;
  url: string;
}

/**
 * WHICH WIRED CARDS ARE PAGES (PURE): a card that carries a page address, in
 * wire order, deduped by slug. A card with no address, a video and every file
 * or selection card contribute nothing — they are not pages and nothing opens.
 */
export function askPageSources(
  cards: readonly AskPacketCard[],
): AskPageSource[] {
  const seen = new Set<string>();
  const sources: AskPageSource[] = [];
  for (const card of cards) {
    if (card.pageUrl === undefined || card.pageUrl === "") continue;
    if (card.on === undefined) continue;
    if (seen.has(card.on)) continue;
    seen.add(card.on);
    sources.push({ on: card.on, url: card.pageUrl });
  }
  return sources;
}

/**
 * READ every page the ask carries and attach the result to its card's facts.
 * A page that answered contributes its read whole; one that did not
 * contributes its one sentence. The returned list is the SAME cards in the
 * SAME order — the context bound, the order and every other field are
 * untouched — and a list with no page card is returned as it came (no fetcher
 * is even called, so an ask with no page never starts the sidecar for one).
 */
export async function readAskPages(
  cards: readonly AskPacketCard[],
  fetch: AskPageFetch,
): Promise<AskPacketCard[]> {
  const sources = askPageSources(cards);
  if (sources.length === 0) return [...cards];
  const pages = new Map<string, AskPacketPage>();
  for (const source of sources) {
    let answer: PageTextAnswer;
    try {
      answer = await fetch(source.url);
    } catch {
      // A seam that throws is the same failed read: one sentence, no retry.
      answer = { kind: "refused", sentence: "that page could not be read." };
    }
    pages.set(
      source.on,
      answer.kind === "text" && answer.text !== ""
        ? { url: source.url, text: answer.text }
        : {
            url: source.url,
            failed:
              answer.kind === "refused"
                ? answer.sentence
                : "that page has no text to read.",
          },
    );
  }
  return cards.map((card) =>
    card.on !== undefined && pages.has(card.on)
      ? { ...card, page: pages.get(card.on) }
      : card,
  );
}
