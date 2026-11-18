import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AskWorkingLine,
  askPartPending,
  askSendPending,
  askSettlePending,
  askWorkingLine,
} from "../src/canvas/AskCard";
import {
  ASK_WORKING_CURATOR,
  ASK_WORKING_TASK,
  askWorkingWords,
} from "../src/canvas/contactRules";
import { renderedMapContent } from "../src/canvas/mapContentRules";

/**
 * STORY 16.28 — IT SAYS IT IS WORKING.
 *
 * The user, live: "There is no loading indicator to let the user know that the
 * LLM is thinking or whatever." The thread now carries ONE quiet line during
 * each wait — the task call before the first streamed word, the curator call
 * after the last — and nothing when idle. It never lies about progress (no
 * percentage, no seconds, no counts, no step numbers, no digits at all), the
 * first streamed part removes it (the text IS the indicator), stop stays
 * available through both waits, and reduce motion draws the marker still
 * without taking the line away.
 *
 * There is no DOM harness, so this file pins the PURE transitions and the
 * RENDER FACTS underneath the human check: the two wordings and their absence
 * of digits; the exact state machine (a started turn, a part, the curator, the
 * settled line); the line's markup and its one animated marker; the CSS
 * reduce-motion block; and the source seams that only a browser could
 * otherwise show (the layer names the curator's start and end; the card's stop
 * is the same stop; no packet or record writer grew a word of this).
 *
 * PROVISIONAL: the two wordings, the marker's breathe, and where the line
 * sits in the thread.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP, "src", rel), "utf8");
}

const ASK_CARD = source("canvas/AskCard.tsx");
const USE_GROUND = source("canvas/useGround.ts");
const SIDECAR = source("turn/sidecar.ts");
const CSS = source("canvas/canvas.css");

/** One rule block, from its selector through its closing brace. */
function rule(css: string, selector: string): string {
  const start = css.indexOf("\n" + selector + " {");
  if (start < 0) throw new Error("no rule for " + selector);
  const end = css.indexOf("}", start);
  return css.slice(start, end + 1);
}

/** Every `prefers-reduced-motion: reduce` block, brace-matched. */
function reducedMotionBlocks(css: string): string[] {
  const marker = "@media (prefers-reduced-motion: reduce) {";
  const blocks: string[] = [];
  let at = css.indexOf(marker);
  while (at >= 0) {
    let depth = 0;
    for (let i = css.indexOf("{", at); i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          blocks.push(css.slice(at, i + 1));
          break;
        }
      }
    }
    at = css.indexOf(marker, at + marker.length);
  }
  return blocks;
}

describe("the two workings are said in words, never in numbers", () => {
  test("the exact wordings", () => {
    expect(ASK_WORKING_TASK).toBe("the model is working");
    expect(ASK_WORKING_CURATOR).toBe("distilling the answer");
    expect(askWorkingWords("task")).toBe(ASK_WORKING_TASK);
    expect(askWorkingWords("curator")).toBe(ASK_WORKING_CURATOR);
  });

  test("NO DIGITS in either line — nothing about how much, or how long", () => {
    for (const line of [ASK_WORKING_TASK, ASK_WORKING_CURATOR]) {
      expect(line).not.toMatch(/[0-9]/);
      expect(line).not.toMatch(/percent|%|second|minute|token|step|of [0-9]/i);
    }
    // The renderer concatenates nothing into the line: the rules return the
    // very strings above.
    expect(askWorkingWords("task")).not.toMatch(/[0-9]/);
    expect(askWorkingWords("curator")).not.toMatch(/[0-9]/);
  });
});

describe("three states, one line each, and the text takes over", () => {
  test("a started turn owes the task line", () => {
    const pending = askSendPending("is the gauge calibrated?");
    expect(askWorkingLine(pending, "task")).toBe(ASK_WORKING_TASK);
    // Idle says nothing, whatever the pending line is.
    expect(askWorkingLine(pending, "idle")).toBeNull();
    expect(askWorkingLine(null, "task")).toBeNull();
  });

  test("the FIRST PART removes the line — the streamed text IS the indicator", () => {
    const started = askSendPending("is the gauge calibrated?");
    const streamed = askPartPending(started, "the note says");
    expect(askWorkingLine(streamed, "task")).toBeNull();
    // A later part never brings it back either.
    const more = askPartPending(streamed, "the note says it was.");
    expect(askWorkingLine(more, "task")).toBeNull();
  });

  test("a finished answer with the curator running owes the distil line", () => {
    const answered = askPartPending(
      askSendPending("is the gauge calibrated?"),
      "the note says it was.",
    );
    expect(askWorkingLine(answered, "curator")).toBe(ASK_WORKING_CURATOR);
    // The curator's line goes the moment the second call ends: success or
    // failure, the layer names idle and the card's own sentences take over.
    expect(askWorkingLine(answered, "idle")).toBeNull();
  });

  test("a curator phase with no reply to distil says nothing", () => {
    // This cannot happen on the real path (the curator starts only after a
    // completed answer), and inventing a line here would claim work over no
    // text at all.
    expect(askWorkingLine(askSendPending("why?"), "curator")).toBeNull();
  });

  test("a stopped or broken turn clears the line", () => {
    const started = askSendPending("why?");
    expect(askSettlePending(started, false, true)).toBeNull();
    const partial = askSettlePending(
      askPartPending(started, "because the"),
      false,
      false,
    );
    expect(askWorkingLine(partial, "task")).toBeNull();
    expect(askWorkingLine(partial, "curator")).toBeNull();
  });
});

describe("the line is one quiet line in the card's voice", () => {
  const html = renderToStaticMarkup(
    createElement(AskWorkingLine, { line: ASK_WORKING_TASK }),
  );

  test("it renders the words, with no number anywhere in the markup", () => {
    expect(html).toContain(ASK_WORKING_TASK);
    expect(html).not.toMatch(/[0-9]/);
    expect(html).not.toContain("ask-card-problem");
    expect(html).not.toContain("role=\"alert\"");
    expect(html).not.toContain("ground-toast");
  });

  test("the marker is the one animated thing; the words are plain", () => {
    expect(html).toContain("ask-working");
    expect(html).toContain("ask-working-marker");
    expect(html).toContain("aria-hidden=\"true\"");
    expect(html).toContain("role=\"status\"");
  });
});

describe("the working line's CSS: one breathe, and a static marker under reduce motion", () => {
  test("only the marker animates; the line itself never does", () => {
    const line = rule(CSS, ".ask-working");
    expect(line).not.toContain("animation");
    expect(line).not.toContain("transition");
    const marker = rule(CSS, ".ask-working-marker");
    expect(marker).toContain("animation: ask-working-breathe");
    expect(CSS).toContain("@keyframes ask-working-breathe");
  });

  test("reduce motion draws the marker still and keeps every word", () => {
    const blocks = reducedMotionBlocks(CSS).filter((block) =>
      block.includes(".ask-working-marker"),
    );
    expect(blocks.length).toBeGreaterThan(0);
    const block = blocks[0] as string;
    expect(block).toContain("animation: none !important;");
    // The line's words are never removed or hidden by the setting.
    expect(block).not.toContain("display: none");
    expect(block).not.toContain(".ask-working-text");
  });
});

describe("the source seams a browser would otherwise show", () => {
  test("the card renders the line in the thread, after the pending answer", () => {
    expect(ASK_CARD).toContain("const workingLine = askWorkingLine(pending, phase);");
    const pendingAnswer = ASK_CARD.indexOf("{pendingAnswer !== null && (");
    const working = ASK_CARD.indexOf("{workingLine !== null && <AskWorkingLine");
    expect(pendingAnswer).toBeGreaterThan(0);
    expect(working).toBeGreaterThan(pendingAnswer);
  });

  test("the layer names the curator's start and end, and only around its call", () => {
    const start = USE_GROUND.indexOf('onPhase?.("curator");');
    const call = USE_GROUND.indexOf("await turn.sendMessages(managerRoute, messages);");
    const end = USE_GROUND.indexOf('onPhase?.("idle");', call);
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(call);
    expect(end).toBeGreaterThan(call);
    // The card's own send is what passes the callback down.
    expect(USE_GROUND).toContain("onPhase?: (phase: AskWorkPhase) => void,");
  });

  test("stop reaches whichever call is live — the task's or the curator's", () => {
    // The card keeps ONE stop, offered while the turn runs; the pending line
    // stays running through the curator because it settles only after the
    // whole ask returns.
    expect(ASK_CARD).toContain(
      'const running = pending !== null && pending.ending === "running";',
    );
    const send = ASK_CARD.slice(
      ASK_CARD.indexOf("async function send("),
      ASK_CARD.indexOf("function startFork("),
    );
    const awaited = send.indexOf("await onAskTurn(");
    expect(awaited).toBeGreaterThan(0);
    expect(send.indexOf('setPhase("idle")')).toBeGreaterThan(awaited);
    expect(send.indexOf("askSettlePending")).toBeGreaterThan(awaited);
    // The port's stop targets the active request; the curator's one call sets
    // that same active id, so the existing stop covers both waits.
    const runMessages = SIDECAR.slice(
      SIDECAR.indexOf("async function runMessages("),
      SIDECAR.indexOf("async function runPacket("),
    );
    expect(runMessages).toContain("active = id");
    expect(runMessages).toContain("activeCli = runId");
    const stop = SIDECAR.slice(SIDECAR.indexOf("async stop() {"));
    expect(stop).toContain("stopTurn(transport, id)");
  });

  test("no packet, record or wire writer grew a word of this", () => {
    for (const rel of ["turn/packet.ts", "map/asks.ts", "turn/curator.ts"]) {
      const text = source(rel);
      expect(text).not.toContain(ASK_WORKING_TASK);
      expect(text).not.toContain(ASK_WORKING_CURATOR);
    }
  });

  test("the ground map renders no content of its own (unchanged)", () => {
    expect(renderedMapContent("ground")).toEqual([]);
  });
});
