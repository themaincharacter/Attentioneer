import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ASK_CONTEXT_LABEL, askKindLine } from "../src/canvas/AskCard";
import {
  ASK_BYTES_OPEN,
  ASK_DECLARATION_VERB,
  ASK_OVERFLOW_CLOSE,
  ASK_OVERFLOW_FORK,
  ASK_OVERFLOW_REMOVE,
  ASK_OVERFLOW_VERB,
  ASK_READ_MISSED,
  askCallsWords,
  askLivePageWords,
  askReadMoreWords,
  packetDeclarationWords,
  type AskCallsFacts,
} from "../src/canvas/contactRules";
import { AskCard } from "../src/canvas/AskCard";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import { CONTENT_CLASSES } from "../src/canvas/gates";
import {
  ASK_THREAD_BOUND,
  type AskCard as AskCardRecord,
  type AskTurn,
} from "../src/map/asks";
import {
  assembleAskCardPacket,
  type AskPacketCard,
} from "../src/turn/packet";

/**
 * STORY 16.27 — THE ASK CARD QUIETS DOWN.
 *
 * The user, from a screenshot: "The ask card is very noisy. Not sure why it
 * needs to state all the bytes numbers and stuff." The face keeps its name,
 * what it is, the thread, the question field and one short provenance line;
 * everything the machinery knows lives behind ONE quiet disclosure, closed by
 * default, with every fact intact — the blocks and their sizes, both calls, the
 * live page line, the exact-bytes reader and the full wired-in list.
 *
 * There is no DOM harness, so this file pins the RULES and the RENDER FACTS
 * underneath the human check: the declaration is a closed native disclosure by
 * default and a send never opens it; with the disclosures stripped the face
 * states no size at all; the declaration still carries every fact it carried
 * before (through the same pure rules); the retrieval offer is a verb and its
 * sentence lives in the declaration; the footer is the primary action plus ONE
 * overflow holding exactly fork, remove and close; the honest sentences stand
 * outside the thread and only when they happen; the thread is still the only
 * scroll region; renderedMapContent("ground") stays [].
 *
 * PROVISIONAL: the disclosure verb's wording, the overflow verb and its items,
 * the read-more verb, and where the full provenance list sits.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP, "src", rel), "utf8");
}

const ASK_CARD = source("canvas/AskCard.tsx");
const CSS = source("canvas/canvas.css");

const ASK: AskCardRecord = {
  on: "rain-question",
  name: "Rain question",
  x: 40,
  y: 80,
  anchor: "rain-gauge",
};

const CARD: AskPacketCard = {
  name: "Rain gauge",
  state: null,
  reading: "the first line",
  note: null,
};

const TURNS: AskTurn[] = [
  { role: "person", text: "is the gauge calibrated?", t: "" },
  { role: "answer", text: "the note says it was.", t: "" },
];

const CALLS: AskCallsFacts = {
  task: { row: "workbench", model: "hammer" },
  manager: { row: "workbench", model: "chisel" },
};

function render(props: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(AskCard, {
      ask: ASK,
      anchorName: "Rain gauge",
      context: [CARD],
      turns: TURNS,
      open: true,
      previewLines: 6,
      hasProvider: true,
      calls: CALLS,
      onOpen: () => {},
      onClose: () => {},
      onAskTurn: async () => ({ ok: true }),
      ...props,
    }),
  );
}

/** One native disclosure's opening tag and its body, as the browser sees them. */
function detail(html: string, cls: string): { tag: string; body: string } {
  const start = html.indexOf('<details class="' + cls + '"');
  if (start < 0) throw new Error("no <details class=\"" + cls + "\"> in the markup");
  const tagEnd = html.indexOf(">", start);
  const end = html.indexOf("</details>", tagEnd);
  if (tagEnd < 0 || end < 0) throw new Error("malformed <details>");
  return { tag: html.slice(start, tagEnd + 1), body: html.slice(tagEnd + 1, end) };
}

/** The markup a person actually SEES: every closed disclosure removed. */
function face(html: string): string {
  return html.replace(/<details[\s\S]*?<\/details>/g, "");
}

/* ------------------------------------------------------------------ *
 * CLOSED BY DEFAULT, AND A SEND NEVER OPENS IT
 * ------------------------------------------------------------------ */

describe("the declaration is one quiet verb, closed until a person presses it", () => {
  test("the disclosure is a native <details> with no open attribute", () => {
    const html = render();
    const declaration = detail(html, "ask-card-declaration");
    expect(declaration.tag).not.toContain(" open");
    expect(declaration.body).toContain(ASK_DECLARATION_VERB);
  });

  test("the verb is the check's own wording, and nothing auto-opens it", () => {
    expect(ASK_DECLARATION_VERB).toBe("what will be sent");
    const send = ASK_CARD.slice(
      ASK_CARD.indexOf("async function send("),
      ASK_CARD.indexOf("function startFork("),
    );
    expect(send).not.toContain("declarationRef");
    expect(send).not.toContain(".open = true");
    expect((ASK_CARD.match(/\.open = true/g) ?? []).length).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * THE FACE STATES NO SIZE
 * ------------------------------------------------------------------ */

describe("no sizes, byte counts or token numbers appear on the face", () => {
  test("with every disclosure stripped, the face has no byte talk", () => {
    const faceOnly = face(render());
    for (const banned of [
      "bytes",
      "will go:",
      "the exact bytes",
      "bytes in all",
      ASK_BYTES_OPEN,
      "the task model answers",
      "will be read when you send",
    ]) {
      expect(faceOnly).not.toContain(banned);
    }
    expect(faceOnly).not.toMatch(/\d+\s*bytes/);
  });

  test("the face still shows its name, what it is, the thread and the question", () => {
    const faceOnly = face(render());
    expect(faceOnly).toContain(askKindLine("Rain gauge"));
    expect(faceOnly).toContain("is the gauge calibrated?");
    expect(faceOnly).toContain("the note says it was.");
    expect(faceOnly).toContain("ask-card-question");
    expect(faceOnly).toContain("ask-card-send");
    expect((faceOnly.match(new RegExp(ASK_CONTEXT_LABEL, "g")) ?? []).length).toBe(1);
    expect(faceOnly).toContain(ASK_CONTEXT_LABEL + "Rain gauge");
  });
});

/* ------------------------------------------------------------------ *
 * NOTHING IS LOST: THE DECLARATION KEEPS EVERY FACT
 * ------------------------------------------------------------------ */

describe("the declaration keeps every fact it had, behind the verb", () => {
  test("the blocks, their sizes and the total are byte-identical", () => {
    const packet = assembleAskCardPacket([CARD], TURNS, "", ASK_THREAD_BOUND);
    const body = detail(render(), "ask-card-declaration").body;
    expect(body).toContain(packetDeclarationWords(packet.declaration));
    expect(body).toContain("bytes in all");
    expect(body).toContain("the conversation (");
  });

  test("both calls are named, with the condition", () => {
    const body = detail(render(), "ask-card-declaration").body;
    for (const line of askCallsWords(CALLS)) expect(body).toContain(line);
    expect(body).toContain("the task model answers");
    expect(body).toContain("distils");
  });

  test("the exact-bytes reader is still one press inside the declaration", () => {
    const body = detail(render(), "ask-card-declaration").body;
    expect(body).toContain(ASK_BYTES_OPEN);
    expect(body).toContain("ask-bytes-open");
  });

  test("the pre-send page read line is behind the same verb", () => {
    const pageCard: AskPacketCard = {
      ...CARD,
      name: "the weather log",
      pageUrl: "https://example.org/log",
    };
    const html = render({ context: [pageCard] });
    const pageLine = askLivePageWords("https://example.org/log");
    expect(detail(html, "ask-card-declaration").body).toContain(pageLine);
    expect(face(html)).not.toContain("will be read when you send");
  });

  test("the full wired-in list is behind the same disclosure", () => {
    const second: AskPacketCard = { ...CARD, name: "Old well" };
    const html = render({ context: [CARD, second] });
    const body = detail(html, "ask-card-declaration").body;
    expect(body).toContain("ask-card-context-full");
    expect(body).toContain("Rain gauge");
    expect(body).toContain("Old well");
    expect(face(html)).toContain(ASK_CONTEXT_LABEL + "Rain gauge \u00b7 Old well");
  });

  test("an empty context still says so, inside the declaration", () => {
    const html = render({ context: [] });
    expect(detail(html, "ask-card-declaration").body).toContain(
      "nothing is wired into this question.",
    );
    expect(face(html)).not.toContain("nothing is wired into this question.");
  });
});

/* ------------------------------------------------------------------ *
 * THE RETRIEVAL OFFER IS A VERB
 * ------------------------------------------------------------------ */

describe("the retrieval offer is a verb, not a READ: line", () => {
  test("the verb names the follow-up's block and states no count", () => {
    const words = askReadMoreWords("the weather log");
    expect(words).toBe("read more of the weather log");
    expect(words).not.toMatch(/\d/);
    expect(words).not.toContain("READ:");
  });

  test("the card offers it only after a follow-up, and it opens the declaration", () => {
    expect(ASK_CARD).toContain("askReadMoreWords(sent.read)");
    expect(ASK_CARD).toContain("sent.read !== null");
    expect(ASK_CARD).toContain("ask-card-read-more");
    expect(ASK_CARD).toContain("onClick={openDeclaration}");
    expect(ASK_CARD).toContain("read={sent.read}");
    expect(detail(render(), "ask-card-declaration").body).not.toContain(
      "it asked for one block by name",
    );
  });
});

/* ------------------------------------------------------------------ *
 * THE FOOTER: ONE PRIMARY, ONE OVERFLOW
 * ------------------------------------------------------------------ */

describe("the footer carries the primary action and ONE overflow verb", () => {
  test("the overflow holds exactly fork, remove and close", () => {
    const html = render({
      onForkTurn: async () => ({ ok: true }),
      onRemove: async () => ({ ok: true }),
    });
    const overflow = detail(html, "ask-card-overflow");
    expect(overflow.tag).not.toContain(" open");
    expect(overflow.body).toContain(">" + ASK_OVERFLOW_VERB + "<");
    expect((overflow.body.match(/<button/g) ?? []).length).toBe(3);
    expect(overflow.body).toContain(ASK_OVERFLOW_FORK);
    expect(overflow.body).toContain(ASK_OVERFLOW_REMOVE);
    expect(overflow.body).toContain(ASK_OVERFLOW_CLOSE);
    for (const outsider of ["send", "stop", "open", "read more"]) {
      expect(overflow.body).not.toContain(">" + outsider + "<");
    }
  });

  test("the footer outside the overflow is the primary action only", () => {
    const html = render({ onForkTurn: async () => ({ ok: true }) });
    const actionsStart = html.indexOf('class="ask-card-actions"');
    const overflowAt = html.indexOf('<details class="ask-card-overflow"');
    const outside = html.slice(actionsStart, overflowAt);
    expect(outside).toContain("ask-card-send");
    expect(outside).not.toContain("ask-card-remove");
    expect(outside).not.toContain("ask-card-close");
    expect(outside).not.toContain("ask-card-overflow-fork");
    // The overflow is the actions row's other child: after it, only the divs
    // that close the row and the composer.
    const after = html.slice(html.lastIndexOf("</details>") + "</details>".length);
    expect(after).not.toContain("<button");
  });

  test("the per-turn fork is still there, revealed on hover instead of drawn", () => {
    const html = render({ onForkTurn: async () => ({ ok: true }) });
    expect(html).toContain("ask-turn-fork");
    const rule = CSS.slice(
      CSS.indexOf(".ask-turn-fork {"),
      CSS.indexOf("}", CSS.indexOf(".ask-turn-fork {")),
    );
    expect(rule).toContain("opacity: 0;");
    expect(CSS).toContain(".ask-turn-cell:hover .ask-turn-fork");
  });
});

/* ------------------------------------------------------------------ *
 * HONEST SENTENCES, ONLY WHEN THEY HAPPEN
 * ------------------------------------------------------------------ */

describe("the honest sentences stand only when they happen", () => {
  test("the hit lines are rendered outside the thread, before the composer", () => {
    const bodyAt = ASK_CARD.indexOf('className="ask-card-body"');
    const factsAt = ASK_CARD.indexOf("<AskTurnFactsLine result={hit} />");
    const noCardAt = ASK_CARD.indexOf("<AskNoCardLine line={noCard} />");
    const composerAt = ASK_CARD.indexOf('className="ask-card-ask"');
    expect(bodyAt).toBeGreaterThan(-1);
    expect(factsAt).toBeGreaterThan(bodyAt);
    expect(noCardAt).toBeGreaterThan(bodyAt);
    expect(factsAt).toBeLessThan(composerAt);
    expect(noCardAt).toBeLessThan(composerAt);
    expect(ASK_CARD).toContain("hit !== null && <AskTurnFactsLine");
    expect(ASK_CARD).toContain("noCard !== null && <AskNoCardLine");
  });
});

/* ------------------------------------------------------------------ *
 * ONE SCROLL REGION, AND THE MAP'S OWN CONTENT
 * ------------------------------------------------------------------ */

describe("the thread stays the only scroll region", () => {
  test("the card subscribes to one scrollbox and the disclosure adds none", () => {
    expect((ASK_CARD.match(/onScroll=/g) ?? []).length).toBe(1);
    const declarationBody = CSS.slice(
      CSS.indexOf(".ask-card-declaration-body {"),
      CSS.indexOf("}", CSS.indexOf(".ask-card-declaration-body {")),
    );
    expect(declarationBody).not.toContain("overflow");
  });

  test("the new verbs are content to the plane's gate", () => {
    for (const name of [
      "ask-card-declaration",
      "ask-card-declaration-body",
      "ask-card-context-full",
      "ask-card-read-more",
      "ask-card-overflow",
      "ask-card-overflow-body",
      "ask-card-overflow-fork",
    ]) {
      expect(CONTENT_CLASSES).toContain(name);
    }
  });

  test("the ground map still renders no concept family", () => {
    expect(renderedMapContent("ground")).toEqual([]);
  });
});
