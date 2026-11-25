import type { ReactNode } from "react";

/**
 * STORY 24-8 (ADR-0044) — THE BOARD'S GLYPHS. Hand-drawn inline SVG in the
 * terminal board's own stroke language: 1.5px strokes, round caps, no fills,
 * no icon pack and no new dependency (the hard constraint). Each glyph is
 * decoration beside its bubble's word — the word lives in the tooltip and the
 * aria-label, and is never replaced by the picture. PROVISIONAL (ADR-0044):
 * the drawings themselves.
 */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

/** A question to ask about this card. */
export function IconAsk() {
  return (
    <Glyph>
      <path d="M4 5h16v11H9l-5 4z" />
    </Glyph>
  );
}

/** A note: a page with its lines. */
export function IconNote() {
  return (
    <Glyph>
      <path d="M6 3h9l3 3v15H6z" />
      <path d="M9 11h6M9 15h6" />
    </Glyph>
  );
}

/** Done: the note is saved. */
export function IconDone() {
  return (
    <Glyph>
      <path d="M5 13l4 4 10-10" />
    </Glyph>
  );
}

/** Read more of the source: the text continues downward. */
export function IconReadMore() {
  return (
    <Glyph>
      <path d="M12 4v11M8 11l4 4 4-4M5 20h14" />
    </Glyph>
  );
}

/** Refresh: the reading runs again. */
export function IconRefresh() {
  return (
    <Glyph>
      <path d="M19 8a8 8 0 1 0 1 6" />
      <path d="M19 3v5h-5" />
    </Glyph>
  );
}

/** The system's file manager at this folder. */
export function IconFolder() {
  return (
    <Glyph>
      <path d="M3 6h6l2 2h10v11H3z" />
    </Glyph>
  );
}

/** Point at a file: a pin. */
export function IconPin() {
  return (
    <Glyph>
      <circle cx="12" cy="10" r="3" />
      <path d="M12 21c5-7 7-9 7-11a7 7 0 1 0-14 0c0 2 2 4 7 11z" />
    </Glyph>
  );
}

/** Remove: the quiet x, as it always was. */
export function IconRemove() {
  return (
    <Glyph>
      <path d="M6 6l12 12M18 6L6 18" />
    </Glyph>
  );
}

/** More: the overflow's own dot row (round-cap zero-length strokes). */
export function IconMore() {
  return (
    <Glyph>
      <path d="M6 12h.01M12 12h.01M18 12h.01" />
    </Glyph>
  );
}

/** Run: the delegate starts. */
export function IconRun() {
  return (
    <Glyph>
      <path d="M8 5l11 7-11 7z" />
    </Glyph>
  );
}

/** Stop: the run's own cancel. */
export function IconStop() {
  return (
    <Glyph>
      <rect x="7" y="7" width="10" height="10" />
    </Glyph>
  );
}

/** Keep this as a card: a page with a plus. */
export function IconKeep() {
  return (
    <Glyph>
      <path d="M6 3h9l3 3v15H6z" />
      <path d="M12 10v6M9 13h6" />
    </Glyph>
  );
}

/** Test this row: a check inside a ring. */
export function IconTest() {
  return (
    <Glyph>
      <circle cx="12" cy="12" r="8" />
      <path d="M8 12l3 3 5-6" />
    </Glyph>
  );
}

/** Sign in: the tool's own key. */
export function IconKey() {
  return (
    <Glyph>
      <circle cx="8" cy="12" r="3" />
      <path d="M11 12h9M17 12v3M20 12v2" />
    </Glyph>
  );
}

/** Wire: the cable you drag out of a terminal. */
export function IconWire() {
  return (
    <Glyph>
      <path d="M9 7H7a5 5 0 0 0 0 10h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8" />
    </Glyph>
  );
}

/** Open settings: the sliders. */
export function IconSettings() {
  return (
    <Glyph>
      <path d="M4 8h16M4 16h16" />
      <circle cx="9" cy="8" r="2" />
      <circle cx="15" cy="16" r="2" />
    </Glyph>
  );
}

/** Send: the question leaves. */
export function IconSend() {
  return (
    <Glyph>
      <path d="M4 12h14M13 7l5 5-5 5" />
    </Glyph>
  );
}

/** Fork: a turn that makes a branch. */
export function IconFork() {
  return (
    <Glyph>
      <path d="M7 4v10a4 4 0 0 0 4 4h3" />
      <path d="M14 14l4 4-4 4" />
    </Glyph>
  );
}

/** Close: the face folds shut. */
export function IconCollapse() {
  return (
    <Glyph>
      <path d="M6 14l6-6 6 6" />
    </Glyph>
  );
}
