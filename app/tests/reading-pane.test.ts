import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ReadingPane, AskDockBody } from "../src/canvas/ReadingPane";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LAYER = readFileSync(
  join(import.meta.dir, "../src/canvas/GroundLayer.tsx"),
  "utf8",
);

describe("the reading pane (story 25-8)", () => {
  const docked = {
    slug: "rain-gauge",
    name: "Rain gauge",
    text: "line one\nline two\nline three",
  };

  test("the dock carries the name, the full reading and the person's note", () => {
    const html = renderToStaticMarkup(
      createElement(ReadingPane, {
        docked,
        note: "my own words",
        onSetNote: async () => ({ ok: true }),
        onClose: () => {},
      }),
    );
    // The name in the hand voice (the pill's own class), the whole text (no
    // crop, no clamp — the pane is where the full reading lands), the note.
    expect(html).toContain('class="ground-name reading-pane-name"');
    expect(html).toContain("Rain gauge");
    expect(html).toContain("line one");
    expect(html).toContain("line three");
    expect(html).toContain("my own words");
    // And one quiet way out.
    expect(html).toContain('class="reading-pane-close verb-key"');
  });

  test("a card with no reading says so plainly", () => {
    const html = renderToStaticMarkup(
      createElement(ReadingPane, {
        docked: { slug: "blank", name: "", text: null },
        note: "",
        onSetNote: async () => ({ ok: true }),
        onClose: () => {},
      }),
    );
    expect(html).toContain("no reading on this card");
    // The absent name reads the quiet absence, never the sentinel.
    expect(html).toContain("no name yet");
  });

  test("the docked card lights its one quiet marker", () => {
    expect(LAYER).toContain('className="ground-reading-mark"');
    expect(LAYER).toContain("dockedOn === reference.on");
  });
});

describe("the ask's face in the pane (story 25-9)", () => {
  const turns = [
    { role: "person", text: "tell me about this deal" },
    { role: "answer", text: "it is a lifetime deal" },
  ];

  test("the thread pages in the pane and the composer waits at the foot", () => {
    const html = renderToStaticMarkup(
      createElement(AskDockBody, {
        ask: { on: "ask-1" },
        turns,
        hasProvider: true,
        onOpenSettings: () => {},
        onAskTurn: async () => ({ ok: true }),
        onStopAskTurn: async () => {},
      }),
    );
    // The thread's own words, in the thread's own voices.
    expect(html).toContain("tell me about this deal");
    expect(html).toContain("it is a lifetime deal");
    expect(html).toContain('class="ask-turn person"');
    expect(html).toContain('class="ask-turn answer"');
    // And the composer.
    expect(html).toContain('class="reading-pane-note"');
    expect(html).toContain(">send<");
  });

  test("with nothing configured it says so and offers the one door", () => {
    const html = renderToStaticMarkup(
      createElement(AskDockBody, {
        ask: { on: "ask-1" },
        turns: [],
        hasProvider: null,
        onOpenSettings: () => {},
        onAskTurn: async () => ({ ok: true }),
        onStopAskTurn: async () => {},
      }),
    );
    expect(html).toContain("nothing configured");
    expect(html).toContain("settings");
    expect(html).not.toContain(">send<");
  });

  test("the ask's body press docks, and its pill still opens nothing", () => {
    const ASK = readFileSync(
      join(import.meta.dir, "../src/canvas/AskCard.tsx"),
      "utf8",
    );
    expect(ASK).toContain("if (onPill) return;");
    expect(ASK).toContain(
      "onDock({ slug: ask.on, name: ask.name, text: null })",
    );
  });
});
