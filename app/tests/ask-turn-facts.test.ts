import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AskCard,
  AskTurnFactsLine,
} from "../src/canvas/AskCard";
import { ASK_READ_MISSED } from "../src/canvas/contactRules";
import type { GroundAddResult } from "../src/canvas/useGround";
import { PROVIDER_SENTENCES } from "../src/turn/providers";
import { STEP_LIMIT_SENTENCE } from "../src/turn/steps";
import type { AskCard as AskCardRecord, AskTurn } from "../src/map/asks";

/**
 * STORY 17.7b — THE CARD SAYS WHAT THE TURN HIT.
 *
 * The retired panel surfaced two facts the turn computes and the card drew
 * nowhere: the step ceiling's sentence and the missed READ's sentence. The
 * card now renders each as ONE quiet line from the turn result, and it says
 * "nothing configured" BEFORE the send instead of only after a failure.
 *
 * The story's human check ("set the budget low and ask; ask with nothing
 * configured; ask for a block the anchor cannot read") is pinned here at the
 * render seam, which is what a test can hold:
 *   - a result carrying `reached` renders STEP_LIMIT_SENTENCE, stated, with no
 *     count of steps;
 *   - a result carrying `missed` renders ASK_READ_MISSED and lists no
 *     internal key;
 *   - a clean result renders NOTHING;
 *   - an expanded card with no provider says the one existing sentence, offers
 *     the settings verb, and does NOT offer send or a question box;
 *   - a configured card composes as before.
 */

const CARD: AskCardRecord = {
  on: "ask-rain",
  name: "The rain question",
  x: 40,
  y: 80,
  anchor: "rain-gauge",
};

const TURN: AskTurn = { role: "answer", text: "it rained", t: "" };

function renderFacts(result: GroundAddResult): string {
  return renderToStaticMarkup(createElement(AskTurnFactsLine, { result }));
}

function renderCard(hasProvider: boolean | null): string {
  return renderToStaticMarkup(
    createElement(AskCard, {
      ask: CARD,
      anchorName: "Rain gauge",
      turns: [TURN],
      open: true,
      previewLines: 6,
      hasProvider,
      onOpenSettings: () => {},
      onOpen: () => {},
      onClose: () => {},
      onAskTurn: async () => ({ ok: true }),
    }),
  );
}

describe("the step ceiling is said, never counted", () => {
  test("a result carrying reached renders the EXISTING sentence", () => {
    const html = renderFacts({ ok: true, reached: STEP_LIMIT_SENTENCE });
    expect(html).toContain(STEP_LIMIT_SENTENCE);
    // Stated, never a ratio: no "3 of 3" anywhere on the line.
    expect(html).not.toMatch(/\d+\s*(of|\/)\s*\d+/);
  });

  test("the line is the card's quiet one, with no error dressing", () => {
    const html = renderFacts({ ok: true, reached: STEP_LIMIT_SENTENCE });
    expect(html).toContain("ask-fork-missing");
    expect(html).not.toContain("ask-card-problem");
    expect(html).not.toContain("role=\"alert\"");
  });
});

describe("a missed READ is said without listing anything internal", () => {
  test("a result carrying missed renders the EXISTING sentence", () => {
    const html = renderFacts({ ok: true, missed: "the weather log" });
    expect(html).toContain(ASK_READ_MISSED);
    // The name the model asked for never rides the sentence.
    expect(html).not.toContain("the weather log");
    expect(html).not.toContain("READ:");
  });

  test("both facts may land on one turn as two quiet lines", () => {
    const html = renderFacts({
      ok: true,
      reached: STEP_LIMIT_SENTENCE,
      missed: "the weather log",
    });
    expect(html).toContain(STEP_LIMIT_SENTENCE);
    expect(html).toContain(ASK_READ_MISSED);
  });
});

describe("a clean turn says none of it", () => {
  test("a result with no reached and no missed renders NOTHING", () => {
    expect(renderFacts({ ok: true })).toBe("");
    expect(
      renderFacts({ ok: true, reached: null, missed: null }),
    ).toBe("");
  });

  test("an empty missed name is not a missed READ", () => {
    expect(renderFacts({ ok: true, missed: "   " })).toBe("");
  });
});

describe("nothing configured is said BEFORE the send", () => {
  test("the expanded card says the one existing sentence and offers settings", () => {
    const html = renderCard(false);
    // The SAME sentence a failed send shows; no second wording exists.
    expect(html).toContain(PROVIDER_SENTENCES.nothing);
    expect(html).toContain("open settings");
    // The send is NOT offered, and the question box is not there to type in.
    expect(html).not.toContain("ask-card-send");
    expect(html).not.toContain("ask-card-question");
    expect(html).not.toContain(">send<");
  });

  test("a configured card composes as before", () => {
    const html = renderCard(true);
    expect(html).toContain("ask-card-question");
    expect(html).toContain("ask-card-send");
    expect(html).not.toContain(PROVIDER_SENTENCES.nothing);
    expect(html).not.toContain("open settings");
  });

  test("an unknown selection claims nothing", () => {
    const html = renderCard(null);
    expect(html).toContain("ask-card-send");
    expect(html).not.toContain(PROVIDER_SENTENCES.nothing);
  });
});
