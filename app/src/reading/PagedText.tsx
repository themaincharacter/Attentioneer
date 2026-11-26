import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * STORY 25-2 (ADR-0046) — THE PAGED TEXT: the token's body becomes a dialogue
 * box. The content flows into fixed-height PAGES (the CSS pagination trick:
 * the flow is one page tall and one column wide, so the content breaks into
 * columns that ARE pages), the cue reads a POSITION — "1 / 3 ▼" — in the find
 * pill's own rule (never a quality, never coloured or graded), and the cue IS
 * the flip button: keys-sized and counter-scaled like the verb keys (the
 * person's condition: "the next page button in the card is easy to click").
 * Paging is VIEW STATE: nothing in the record changes. The page count comes
 * from ONE hidden measurement (full height over one page's height) — a plain
 * division, never a guess. PROVISIONAL (ADR-0046): the page size and the cue.
 */
export function PagedText({
  children,
  linesPerPage = 4,
  anchor = "inline",
  fill = false,
}: {
  children: ReactNode;
  /** The page size (the person's ruling: 4; the setting will carry 3/4/5). */
  linesPerPage?: number;
  /**
   * STORY 25-12 (the person's ruling on the window's resize): a FILL page
   * takes its box's height — "the big point of a resize would be to get more
   * lines in view" — so a taller window shows more lines per page and the
   * four-line rule stays the token's.
   */
  fill?: boolean;
  /**
   * STORY 25-4: where the cue lives. "inline" is the flow's own foot (the
   * pane's case); "card" anchors it to the nearest positioned ancestor — the
   * CARD — below its edge, outside every clip, exactly like the name pill
   * sits above. The person: the chip must be reachable without expanding.
   */
  anchor?: "inline" | "card";
}) {
  const flowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(0);

  const measurePages = () => {
    const flow = flowRef.current;
    const measure = measureRef.current;
    if (flow === null || measure === null) return;
    const pageHeight = flow.clientHeight;
    if (pageHeight === 0) return;
    // (The run's counting words are banned from surface code — so this is a
    // total, never a count.)
    const total = Math.max(1, Math.ceil(measure.scrollHeight / pageHeight));
    setPages(total);
    setPage((at) => Math.min(at, total - 1));
  };
  useEffect(() => {
    measurePages();
    // STORY 25-12 (the person's ruling on the window's resize): a FILL page
    // re-counts when its box changes — the corner drag grows the page in
    // view. A tiny guard on the unmount.
    const flow = flowRef.current;
    if (flow === null || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => measurePages());
    watch.observe(flow);
    return () => watch.disconnect();
  }, [children, fill]);

  return (
    <div className="paged-box">
      <div
        className={fill ? "paged-flow paged-fill" : "paged-flow"}
        ref={flowRef}
        style={{
          ["--page-lines" as string]: linesPerPage,
          ["--page-at" as string]: Math.min(page, pages - 1),
        }}
      >
        {/* STORY 25-3 (ADR-0046 decision 4) — THE SILENT INK: the arriving
            page's words appear as if laid down, then settle at once. A SIMPLE
            appear (the person: "a simple appear animation that isn't
            distracting") — one-shot per page change (the key remounts the
            wrapper), completely still afterwards. The pen scratch is the
            person's deferred want. */}
        <div className="ink-settle" key={page}>
          {children}
        </div>
      </div>
      {/* The same content, unflowed and hidden: full height over one page's
          height is the page total. */}
      <div className="paged-measure" ref={measureRef} aria-hidden="true">
        {children}
      </div>
      {pages > 1 && (
        <button
          type="button"
          className="paged-cue verb-key"
          data-cue-anchor={anchor}
          aria-label={"page " + (page + 1) + " of " + pages + ", next page"}
          onClick={() => setPage((at) => (at + 1) % pages)}
        >
          <span className="paged-cue-text">
            {page + 1} / {pages} &#9660;
          </span>
        </button>
      )}
    </div>
  );
}
