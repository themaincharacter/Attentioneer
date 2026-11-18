import {
  pageRequestLine,
  stopLine,
  thumbRequestLine,
  type SidecarLine,
} from "./protocol";
import { createSidecarTransport, startSidecar } from "./sidecar";
import { errorSentence, type TurnTransport } from "./turn";

/**
 * THE WINDOW'S ONE PAGE READ (story 16.14) — the small seam between a pasted
 * address and the sidecar's `page`/`thumb` requests. It is shaped like
 * `modelFetch.ts` on purpose: the same transport, the same one-subscriber-by-id
 * fan-out, the same one-sentence refusal and the same one budget. There is no
 * second pipe.
 *
 * THE WINDOW NEVER FETCHES. It sends an address, waits for one `page` line,
 * and then — only when the page declared an image — sends one `thumb` request
 * and gets bytes back as base64. The calling write path decides what to keep;
 * this file decides nothing about a card and touches no file.
 *
 * A THUMBNAIL THAT FAILS IS NOT AN ERROR: the page's read stands, the card has
 * no image, and nothing is said about it (the story's rule). A PAGE that fails
 * is one sentence, and the caller creates nothing.
 *
 * NO RETRY, NO CACHE: one press asks once. A timeout asks the sidecar to stop
 * the fetch at its source so the process does not keep waiting behind a UI that
 * gave up. PROVISIONAL: the budget and the one stop sentence.
 */

/** How long the window waits for a page (or its thumbnail) before giving up. */
export const PAGE_FETCH_TIMEOUT_MS = 20_000;

/** The one sentence a stopped page read answers (PROVISIONAL wording). */
export const PAGE_STOPPED = "the page read was stopped.";

/** One downloaded image, base64 as it crossed the wire. */
export interface PageImage {
  mime: string;
  base64: string;
}

/** What one page read answered: the read, or one sentence. */
export type PageFetchAnswer =
  | {
      kind: "page";
      title: string;
      text: string;
      /** The local-to-be image; null when the page offered none or it failed. */
      thumb: PageImage | null;
    }
  | { kind: "refused"; sentence: string };

/** What one press needs: one address in, one read (or sentence) out. */
export type PageFetcher = (url: string) => Promise<PageFetchAnswer>;

/** Separate from the turn and model ids, so a page can never answer a turn. */
let nextPageFetchId = 1;

/** One id's answer: the expected line, one error sentence, or a timeout. */
type Once =
  | { kind: "line"; line: SidecarLine }
  | { kind: "error"; sentence: string }
  | { kind: "timeout" };

/**
 * Send ONE request and wait for its ONE line. The subscriber is registered
 * before the request leaves, so a fast answer cannot outrun it; the budget
 * settles first and then stops the request at its source.
 */
async function once(
  transport: TurnTransport,
  id: number,
  expected: "page" | "thumb",
  request: string,
  timeoutMs: number,
): Promise<Once> {
  let settle: (answer: Once) => void = () => {};
  let unsubscribe: () => void = () => {};
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const answer = new Promise<Once>((resolve) => {
    settle = resolve;
  });

  const finish = (result: Once): void => {
    if (settled) return;
    settled = true;
    if (timer !== null) clearTimeout(timer);
    unsubscribe();
    settle(result);
  };

  unsubscribe = transport.subscribe(id, (line) => {
    if (settled) return;
    if (line.kind === expected) {
      finish({ kind: "line", line });
      return;
    }
    if (line.kind === "error") {
      finish({ kind: "error", sentence: errorSentence(line.message) });
      return;
    }
    if (line.kind === "cancelled") {
      finish({ kind: "error", sentence: PAGE_STOPPED });
    }
  });

  timer = setTimeout(() => {
    // Settle FIRST, then let the fetch go: the person must not see a timeout
    // over a request that is still running.
    finish({ kind: "timeout" });
    void transport.send(stopLine(id)).catch(() => {
      // A pipe already gone is the same timeout, said once.
    });
  }, timeoutMs);

  try {
    await transport.send(request);
  } catch {
    finish({ kind: "error", sentence: PAGE_STOPPED });
  }

  return await answer;
}

/**
 * Read ONE page (and, quietly, its thumbnail). The page request carries the
 * address VERBATIM; the text and title come back already reduced, and the
 * image follows as a second guarded fetch. Nothing here writes anything.
 */
export async function fetchPage(
  transport: TurnTransport,
  url: string,
  timeoutMs: number = PAGE_FETCH_TIMEOUT_MS,
): Promise<PageFetchAnswer> {
  const id = nextPageFetchId++;
  const page = await once(transport, id, "page", pageRequestLine(id, url), timeoutMs);
  if (page.kind === "timeout") {
    return { kind: "refused", sentence: "that page took too long to answer." };
  }
  if (page.kind === "error") {
    return { kind: "refused", sentence: page.sentence };
  }
  if (page.line.kind !== "page") {
    return { kind: "refused", sentence: "that page could not be read." };
  }
  const read = page.line;
  let thumb: PageImage | null = null;
  if (read.thumbUrl !== null && read.thumbUrl !== "") {
    const thumbId = nextPageFetchId++;
    const image = await once(
      transport,
      thumbId,
      "thumb",
      thumbRequestLine(thumbId, read.thumbUrl),
      timeoutMs,
    );
    if (
      image.kind === "line" &&
      image.line.kind === "thumb" &&
      image.line.data !== ""
    ) {
      thumb = { mime: image.line.mime, base64: image.line.data };
    }
    // Anything else is simply no picture: the card says nothing about it.
  }
  return {
    kind: "page",
    title: read.title,
    text: read.text,
    thumb,
  };
}

/**
 * The app's fetcher: make sure the child is up, then ask it. A sidecar that
 * will not start is its own sentence — the page was never reached, so the
 * bubble must not blame the address.
 */
export function createPageFetcher(
  transport: TurnTransport = createSidecarTransport(),
): PageFetcher {
  return async (url) => {
    const started = await startSidecar();
    if (started.kind === "refused") {
      return { kind: "refused", sentence: started.sentence };
    }
    return await fetchPage(transport, url);
  };
}
