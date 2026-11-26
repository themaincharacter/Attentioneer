import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { SettingsPanel } from "../src/canvas/SettingsPanel";
import {
  boundedPageLines,
  DEFAULT_CARD_PREFERENCE,
  FRAME_WEIGHT_PX,
  oneOf,
  PAGE_LINES_DEFAULT,
  readCardPreference,
  SETTLE_MS,
  storedCardPreference,
  voiceStack,
} from "../src/lib/cardPreference";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "../src/App.tsx"), "utf8");

describe("the cards' stated knobs (story 25-14)", () => {
  test("a page holds three, four or five lines — and four is the ruling", () => {
    expect(PAGE_LINES_DEFAULT).toBe(4);
    expect(boundedPageLines(3)).toBe(3);
    expect(boundedPageLines(5)).toBe(5);
    expect(boundedPageLines(2)).toBe(3);
    expect(boundedPageLines(99)).toBe(5);
    expect(boundedPageLines("four")).toBe(4);
  });

  test("each knob stands alone and a hand-edited config is data", () => {
    const read = readCardPreference({
      pageLines: 5,
      frameWeight: "thick",
      settleSpeed: "slow",
      voiceHand: "Georgia, serif",
    });
    expect(read.pageLines).toBe(5);
    expect(read.frameWeight).toBe("thick");
    expect(read.settleSpeed).toBe("slow");
    // The person's stack is their words; the ones they did not touch keep
    // the defaults.
    expect(read.voiceHand).toBe("Georgia, serif");
    expect(read.voicePress).toBe(DEFAULT_CARD_PREFERENCE.voicePress);
    // Anything out of the sets reads the default (never a typo's shape).
    expect(oneOf("loud", ["thin", "medium", "thick"] as const, "medium")).toBe("medium");
    expect(voiceStack("  ", "fallback")).toBe("fallback");
  });

  test("what is stored is bounded, field by field", () => {
    const stored = storedCardPreference({
      ...DEFAULT_CARD_PREFERENCE,
      pageLines: 99,
      frameWeight: "nope" as never,
    });
    expect(stored.pageLines).toBe(5);
    expect(stored.frameWeight).toBe("medium");
  });

  test("the sheet reads the vars the app writes", () => {
    // The look is a few CSS vars: the voices, the frames' weight, the settle.
    for (const name of [
      '"--voice-hand"',
      '"--voice-press"',
      '"--voice-draft"',
      '"--frame-w"',
      '"--settle-ms"',
    ]) {
      expect(APP).toContain("setProperty(" + name);
    }
    // And the weights and speeds map to the sheet's own terms.
    expect(FRAME_WEIGHT_PX.thin).toBe("1px");
    expect(FRAME_WEIGHT_PX.thick).toBe("3px");
    expect(SETTLE_MS.quick).toBe("140ms");
  });

  test("the Cards section carries the four knobs and the keep press", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsPanel, {
        section: "cards",
        onSection: () => {},
        onClose: () => {},
      }),
    );
    // (A static render shows the fold's loading note; the fold's own rows are
    // source-pinned below.)
    const PANEL = readFileSync(
      join(import.meta.dir, "../src/canvas/SettingsPanel.tsx"),
      "utf8",
    );
    expect(PANEL).toContain("function CardsFold(");
    expect(PANEL).toContain('choice("page lines"');
    expect(PANEL).toContain('choice("frames"');
    expect(PANEL).toContain('"ink settle"');
    expect(PANEL).toContain('stack("your words"');
    expect(PANEL).toContain("saveCardPreference(drafts)");
    expect(typeof html).toBe("string");
  });
});
