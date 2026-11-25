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
}: {
  children: ReactNode;
  linesPerPage?: number;
}) {
  const flowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(0);

  useEffect(() => {
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
  }, [children]);

  return (
    <div className="paged-box">
      <div
        className="paged-flow"
        ref={flowRef}
        style={{
          ["--page-lines" as string]: linesPerPage,
          ["--page-at" as string]: Math.min(page, pages - 1),
        }}
      >
        {children}
      </div>
      {/* The same content, unflowed and hidden: full height over one page's
          height is the page count. */}
      <div className="paged-measure" ref={measureRef} aria-hidden="true">
        {children}
      </div>
      {pages > 1 && (
        <button
          type="button"
          className="paged-cue verb-key"
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
