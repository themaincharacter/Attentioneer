/**
 * STORY 17 (shortlist items 7-9) - THE FOLD THRESHOLD, STATED ONCE.
 *
 * The number of lines a ground card's face shows is a PREFERENCE, not a
 * constant hidden in a CSS clamp: the person can see it in Settings and change
 * it, and the card's crop and the DOM's clamp both read it. This module is the
 * PURE half - the shape, the defaults and the bounds - so the same rule can be
 * asserted without a window and neither the config writer nor the card has to
 * invent its own clamp.
 *
 * BOUNDED BY CONSTRUCTION: a hand-edited config cannot make a card show zero
 * lines or a hundred; a value outside the bounds is read at the nearest bound,
 * and a value that is not a number at all reads as the default. Stored values
 * are raw numbers, field by field, so nothing else can ride into the file.
 *
 * WHY A PREFERENCE AND NOT A COUNTER: nothing here counts, sums or nudges. The
 * threshold is the person's statement about how much of a card they want to
 * read before opening it; the card's fade and "more" are the noun's own verbs,
 * never a progress or a number shown on the map.
 *
 * PROVISIONAL (story 17): the two defaults (6 preview, 2 note) and the bounds
 * (2..20) are the story's hypothesis, not an ADR. The config key lives in
 * lib/appConfig.ts; the Settings row is canvas/SettingsPanel.tsx.
 */

/** The reading's face shows this many lines until the person says otherwise. */
export const READING_PREVIEW_DEFAULT = 6;

/** The note's face shows this many lines until the person says otherwise. */
export const NOTE_PREVIEW_DEFAULT = 2;

/** The smallest stated count (a face has to show something). */
export const PREVIEW_LINES_FLOOR = 2;

/** The largest stated count (beyond this it is a scroll, not a face). */
export const PREVIEW_LINES_CEILING = 20;

/** The two stated counts, one per crop. Both are numbers, both are bounded. */
export interface ReadingPreference {
  /** Lines of the stored reading on the small card. */
  readonly previewLines: number;
  /** Lines of the person's note on the small card. */
  readonly noteLines: number;
}

/** What a program that never read the config uses. */
export const DEFAULT_READING_PREFERENCE: ReadingPreference = {
  previewLines: READING_PREVIEW_DEFAULT,
  noteLines: NOTE_PREVIEW_DEFAULT,
};

/**
 * One stated count, read through the bounds. Accepts a number or a numeric
 * string (a hand-edited config is data, not a schema), rounds a fraction to a
 * whole line, and answers the default when the value is not a number at all.
 * PURE.
 */
export function boundedPreviewLines(value: unknown, fallback: number): number {
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(raw)) return fallback;
  const whole = Math.round(raw);
  return Math.min(PREVIEW_LINES_CEILING, Math.max(PREVIEW_LINES_FLOOR, whole));
}

/**
 * The preference from the config's value. Anything that is not an object is
 * the default, and each field is bounded on its own - a missing note count
 * never borrows the reading's, because the two crops are separate statements.
 * PURE.
 */
export function readReadingPreference(value: unknown): ReadingPreference {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_READING_PREFERENCE;
  }
  const record = value as Record<string, unknown>;
  return {
    previewLines: boundedPreviewLines(
      record.previewLines,
      READING_PREVIEW_DEFAULT,
    ),
    noteLines: boundedPreviewLines(record.noteLines, NOTE_PREVIEW_DEFAULT),
  };
}

/**
 * The exact object written to the config: two bounded numbers and nothing
 * else, built field by field. PURE, so a test can see the stored shape without
 * touching a file.
 */
export function storedReadingPreference(preference: ReadingPreference): {
  previewLines: number;
  noteLines: number;
} {
  return {
    previewLines: boundedPreviewLines(
      preference.previewLines,
      READING_PREVIEW_DEFAULT,
    ),
    noteLines: boundedPreviewLines(preference.noteLines, NOTE_PREVIEW_DEFAULT),
  };
}
