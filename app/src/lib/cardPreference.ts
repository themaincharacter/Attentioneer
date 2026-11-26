/**
 * STORY 25-14 (ADR-0047's settings) — THE CARDS' STATED KNOBS.
 *
 * The person's ruling: the cards refactor is "very customizable in the
 * settings". This module is the PURE half — the shape, the defaults and the
 * bounds — exactly like lib/readingPreference.ts: the same rule can be
 * asserted without a window, and neither the config writer nor the card
 * invents its own clamp. The config key lives in lib/appConfig.ts; the rows
 * are canvas/SettingsPanel.tsx's Cards fold.
 *
 * THE FOUR KNOBS: how many lines a token's page holds (the person's ruling:
 * four, with three and five beside it), how boldly the frames are drawn, how
 * quickly the ink settle lands, and the three VOICE STACKS (the fonts the
 * hand, the press and the draft read in — system stacks only, the hard
 * constraint: no webfont is ever fetched).
 *
 * NOTHING here counts, scores or nudges; every value is the person's own
 * statement about how their cards should look. PROVISIONAL (25-14): every
 * default and bound in this file.
 */

/** The token's page holds this many lines until the person says otherwise. */
export const PAGE_LINES_DEFAULT = 4;

/** The smallest page (a page has to carry a sentence). */
export const PAGE_LINES_MIN = 3;

/** The largest page (beyond this it is a wall again). */
export const PAGE_LINES_MAX = 5;

/** How boldly the frames are drawn. */
export type FrameWeight = "thin" | "medium" | "thick";

/** How quickly the ink settle lands. */
export type SettleSpeed = "quick" | "gentle" | "slow";

/** The person's four statements about their cards. */
export interface CardPreference {
  /** Lines on a token's page (the window's page fills its box regardless). */
  readonly pageLines: number;
  /** The frames' border weight. */
  readonly frameWeight: FrameWeight;
  /** The ink settle's speed. */
  readonly settleSpeed: SettleSpeed;
  /** The hand's font stack (the person's own words). */
  readonly voiceHand: string;
  /** The press's font stack (the agent's words). */
  readonly voicePress: string;
  /** The draft's font stack (the words of absence). */
  readonly voiceDraft: string;
}

export const DEFAULT_VOICE_HAND =
  '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
export const DEFAULT_VOICE_PRESS =
  'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
export const DEFAULT_VOICE_DRAFT =
  '"card-draft", "Segoe Script", "Bradley Hand", cursive';

/** What a program that never read the config uses. */
export const DEFAULT_CARD_PREFERENCE: CardPreference = {
  pageLines: PAGE_LINES_DEFAULT,
  frameWeight: "medium",
  settleSpeed: "gentle",
  voiceHand: DEFAULT_VOICE_HAND,
  voicePress: DEFAULT_VOICE_PRESS,
  voiceDraft: DEFAULT_VOICE_DRAFT,
};

/** The three frames' weights, in the sheet's own terms (PROVISIONAL). */
export const FRAME_WEIGHT_PX: Record<FrameWeight, string> = {
  thin: "1px",
  medium: "2px",
  thick: "3px",
};

/** The settle's duration per speed (PROVISIONAL). */
export const SETTLE_MS: Record<SettleSpeed, string> = {
  quick: "140ms",
  gentle: "260ms",
  slow: "420ms",
};

/** One page's stated count, read through the bounds. PURE. */
export function boundedPageLines(value: unknown): number {
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(raw)) return PAGE_LINES_DEFAULT;
  const whole = Math.round(raw);
  return Math.min(PAGE_LINES_MAX, Math.max(PAGE_LINES_MIN, whole));
}

/** One of a bounded set, or the default. PURE. */
export function oneOf<T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && (options as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * A voice stack: the person's own text. An empty or absent field keeps the
 * default; anything else is their words verbatim (a stack is data). PURE.
 */
export function voiceStack(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

/** The preference from the config's value. Each field stands alone. PURE. */
export function readCardPreference(value: unknown): CardPreference {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_CARD_PREFERENCE;
  }
  const record = value as Record<string, unknown>;
  return {
    pageLines: boundedPageLines(record.pageLines),
    frameWeight: oneOf(
      record.frameWeight,
      ["thin", "medium", "thick"] as const,
      DEFAULT_CARD_PREFERENCE.frameWeight,
    ),
    settleSpeed: oneOf(
      record.settleSpeed,
      ["quick", "gentle", "slow"] as const,
      DEFAULT_CARD_PREFERENCE.settleSpeed,
    ),
    voiceHand: voiceStack(record.voiceHand, DEFAULT_VOICE_HAND),
    voicePress: voiceStack(record.voicePress, DEFAULT_VOICE_PRESS),
    voiceDraft: voiceStack(record.voiceDraft, DEFAULT_VOICE_DRAFT),
  };
}

/** The exact object written to the config. PURE. */
export function storedCardPreference(preference: CardPreference): {
  pageLines: number;
  frameWeight: FrameWeight;
  settleSpeed: SettleSpeed;
  voiceHand: string;
  voicePress: string;
  voiceDraft: string;
} {
  return readCardPreference(preference) as {
    pageLines: number;
    frameWeight: FrameWeight;
    settleSpeed: SettleSpeed;
    voiceHand: string;
    voicePress: string;
    voiceDraft: string;
  };
}
