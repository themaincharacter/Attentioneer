import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GroundLayer, GroundReadingText } from "../src/canvas/GroundLayer";
import {
  READING_LINK_CLASS,
  followReadingLink,
  readingLinkSegments,
} from "../src/canvas/readingLinks";
import type { GroundReference } from "../src/map/ground";
import type { Reading } from "../src/map/readings";

/**
 * STORY 22.7 — A LINK IN THE CARD'S OWN CONTENT OPENS.
 *
 * The person: "we should be able to click a link on the card when its expanded
 * to open that in the default browser." This file pins the rule underneath it:
 *
 *   - WHICH part of a stored reading is a link: an http(s) address in prose,
 *     with the sentence's own punctuation kept out of it and every other scheme
 *     left as text (`javascript:`, `file:`, `mailto:` never prompt);
 *   - the ONE click: it stops the click's propagation, opens the address
 *     through the SAME guarded opener the page card's "open the page" verb
 *     uses, and never begins a drag;
 *   - the collapsed face is plain text: it carries the no-select class and a
 *     URL on it is words, not an anchor.
 *
 * PROVISIONAL: the address's edge punctuation and the link's hit area.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}
const LINKS = source("canvas/readingLinks.ts");
const LAYER = source("canvas/GroundLayer.tsx");
const OUTWARD = source("canvas/outward.ts");
const CSS = source("canvas/canvas.css");

const URL_ONE = "https://example.org/a";
const URL_TWO = "http://example.net/b?c=d&e=f";

describe("which words are a link: http(s) in prose, nothing else", () => {
  test("an address in a sentence is the link; the prose around it stays text", () => {
    expect(readingLinkSegments("see " + URL_ONE + " for more")).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", text: URL_ONE, url: URL_ONE },
      { kind: "text", text: " for more" },
    ]);
  });

  test("the sentence's punctuation is not part of the address", () => {
    expect(readingLinkSegments("read (" + URL_ONE + ").")).toEqual([
      { kind: "text", text: "read (" },
      { kind: "link", text: URL_ONE, url: URL_ONE },
      { kind: "text", text: ")." },
    ]);
  });

  test("a bracket the address opened itself stays inside it", () => {
    const url = "https://example.org/a_(b)";
    expect(readingLinkSegments(url)).toEqual([
      { kind: "link", text: url, url },
    ]);
  });

  test("two addresses are two links, in the order they were read", () => {
    expect(readingLinkSegments(URL_ONE + " and " + URL_TWO)).toEqual([
      { kind: "link", text: URL_ONE, url: URL_ONE },
      { kind: "text", text: " and " },
      { kind: "link", text: URL_TWO, url: URL_TWO },
    ]);
  });

  test("only http(s) is a link; every other scheme stays plain text", () => {
    for (const text of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "mailto:someone@example.org",
      "tel:+15551234",
      "ftp://example.org/a",
      "www.example.org/a",
      "not a link at all",
    ]) {
      expect(readingLinkSegments(text)).toEqual([{ kind: "text", text }]);
    }
  });

  test("an empty reading is one empty text run", () => {
    expect(readingLinkSegments("")).toEqual([{ kind: "text", text: "" }]);
  });
});

describe("the click opens through the ONE opener", () => {
  test("the handler stops the click and hands over the exact address", () => {
    const opened: string[] = [];
    let prevented = 0;
    let stopped = 0;
    followReadingLink(
      {
        preventDefault: () => {
          prevented += 1;
        },
        stopPropagation: () => {
          stopped += 1;
        },
      },
      URL_ONE,
      async (url) => {
        opened.push(url);
      },
    );
    expect(opened).toEqual([URL_ONE]);
    expect(prevented).toBe(1);
    expect(stopped).toBe(1);
  });

  test("the same door the page card's 'open the page' verb uses", () => {
    // One opener path: the reading hands the address to `openPageOutward`,
    // the guarded wrapper over the opener plugin, still its only call site.
    expect(LINKS).toContain("openPageOutward");
    expect(OUTWARD).toContain("export async function openPageOutward(");
    expect(LAYER).toContain("void openPageOutward(url)");
  });

  test("a link click never begins a drag", () => {
    // The press is stopped on the reading (a child of the card's drag surface)
    // before the card's raw wiring can read it, and the link module owns no
    // drag at all — a second drag rule would be another press rule.
    const guard = LAYER.slice(
      LAYER.indexOf("function onLinkPress"),
      LAYER.indexOf('el.addEventListener("mousedown", onLinkPress)'),
    );
    expect(guard).toContain("e.stopPropagation()");
    expect(guard).not.toContain("beginGroundDrag");
    expect(guard).not.toContain("attachGroundCardDrag");
    expect(LINKS).not.toContain("beginGroundDrag");
    expect(LINKS).not.toContain("attachGroundCardDrag");
  });
});

describe("what a reading renders", () => {
  test("expanded, an http(s) address is the one link element", () => {
    const html = renderToStaticMarkup(
      createElement(GroundReadingText, {
        text: "see " + URL_ONE + " for more",
        open: true,
      }),
    );
    expect(html).toContain('class="' + READING_LINK_CLASS + '"');
    expect(html).toContain('href="' + URL_ONE + '"');
    expect(html).toContain(">" + URL_ONE + "</a>");
  });

  test("expanded, a non-http string is plain text, never an anchor", () => {
    const html = renderToStaticMarkup(
      createElement(GroundReadingText, {
        text: "run javascript:alert(1) but never open it",
        open: true,
      }),
    );
    expect(html).not.toContain("<a");
    expect(html).not.toContain("href=");
    expect(html).toContain("javascript:alert(1)");
  });

  test("collapsed, the very same bytes are text — no link to click", () => {
    const html = renderToStaticMarkup(
      createElement(GroundReadingText, { text: "see " + URL_ONE, open: false }),
    );
    expect(html).not.toContain("<a");
    expect(html).not.toContain("href=");
    expect(html).toContain(URL_ONE);
  });

  test("the link wears the house's openable look", () => {
    expect(CSS).toMatch(
      /\.ground-reading-link \{[^}]*text-decoration: underline;[^}]*\}/s,
    );
    expect(CSS).toMatch(/\.ground-reading-link \{[^}]*cursor: pointer;[^}]*\}/s);
  });
});

const reference: GroundReference = {
  on: "rain-gauge",
  name: "Rain gauge",
  x: 40,
  y: 60,
};
const reading: Reading = {
  on: "rain-gauge",
  form: "path",
  from: "notes/gauge.txt",
  taken: "2026-11-17T12:00:00.000Z",
  bytes: 40,
};
const inertVerbs = {
  onMove: async () => ({ ok: true as const }),
  onRefresh: async () => ({ ok: true as const }),
  onRepoint: async () => ({ ok: true as const }),
  onRemove: async () => ({ ok: true as const }),
};

describe("the collapsed face keeps the address as words", () => {
  test("a small card carries the no-select class and no anchor", () => {
    const html = renderToStaticMarkup(
      createElement(GroundLayer, {
        references: [reference],
        readings: [reading],
        texts: { "rain-gauge": "see " + URL_ONE },
        states: { "rain-gauge": "current" },
        ...inertVerbs,
      }),
    );
    expect(html).toContain("ground-body-collapsed");
    expect(html).not.toContain("<a");
    expect(html).toContain(URL_ONE);
    // The class is the SAME open state the one press predicate reads.
    expect(LAYER).toContain('open ? "" : " ground-body-collapsed"');
  });
});
