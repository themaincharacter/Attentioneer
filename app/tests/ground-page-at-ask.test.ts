import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  parseSidecarLine,
  pageRequestLine,
  type SidecarLine,
  type TurnTransport,
} from "../src/turn/protocol";
import { PAGE_SENTENCES } from "../src/turn/pageExtract";
import { fetchPageText, type PageTextAnswer } from "../src/turn/pageFetch";
import { askPageSources, readAskPages } from "../src/turn/pageAsk";
import {
  ASK_PACKET_PAGE_UNREAD,
  assembleAskCardPacket,
  askPageName,
  type AskPacketCard,
} from "../src/turn/packet";
import { askCardOf, type AskCardFacts } from "../src/turn/context";
import { askLivePageWords } from "../src/canvas/contactRules";
import { GroundLayer } from "../src/canvas/GroundLayer";
import type { GroundReference } from "../src/map/ground";
import { pageReading, type Reading } from "../src/map/readings";
import type { AskTurn } from "../src/map/asks";
import { utf8ByteLength } from "../src/lib/textBytes";

/**
 * STORY 16.26 — A WEB PAGE IS A THUMBNAIL, NOT A TRANSCRIPT.
 *
 * The user's ruling was "just need a simple page thumbnail or something in the
 * card; the llm can open the page and crawl it" and "this won't be a problem
 * now that we are expecting the llm to open the page on ask". So this file pins
 * four things:
 *
 *   - the CARD stores no text: its face is name, "a web page — <title>",
 *     thumbnail and host, and a card WITHOUT text says nothing in the reading
 *     slot (an OLD card with stored text still renders that text, untouched);
 *   - the ASK opens the page: the sidecar's existing `page` method and guards,
 *     ONE request per page card per ask, nothing at render;
 *   - the read RIDES as a declared block: its exact bytes are in the packet and
 *     its size is in the declaration;
 *   - a FAILED read is one citation sentence in the block and the ask still
 *     sends.
 *
 * The real half spawns the actual sidecar over its actual stdio against a local
 * stub page server, and counts the server's requests: no external network.
 */

const APP_DIR = join(import.meta.dir, "..");
const MAIN = join(APP_DIR, "sidecar", "main.ts");
const BUN = process.execPath;

const PAGE_BODY = "Every river is a slow argument.";
const PAGE_HTML =
  "<!doctype html><html><head><title>Rain &amp; Rivers</title>" +
  '<meta property="og:image" content="/thumb.png">' +
  "</head><body><h1>Rivers</h1><p>" + PAGE_BODY + "</p></body></html>";

let pageHits = 0;
let thumbHits = 0;

const stub = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/page") {
      pageHits += 1;
      return new Response(PAGE_HTML, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (path === "/thumb.png") {
      thumbHits += 1;
      return new Response("not asked for", { status: 500 });
    }
    return new Response("gone", { status: 404 });
  },
});

const PAGE_URL = `http://127.0.0.1:${stub.port}/page`;
const MISSING_URL = `http://127.0.0.1:${stub.port}/missing`;

let child: ReturnType<typeof Bun.spawn>;
let wire: TurnTransport;

beforeAll(() => {
  child = Bun.spawn([BUN, MAIN], {
    cwd: APP_DIR,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  const waiting = new Map<number, (line: SidecarLine) => void>();
  const decoder = new TextDecoder();
  let buffer = "";
  void (async () => {
    for await (const chunk of child.stdout as ReadableStream<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const raw = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const line = parseSidecarLine(raw);
        if (line !== null && line.kind !== "hello") waiting.get(line.id)?.(line);
        newline = buffer.indexOf("\n");
      }
    }
  })();
  wire = {
    async send(line) {
      child.stdin.write(line + "\n");
      await child.stdin.flush();
    },
    subscribe(id, handler) {
      waiting.set(id, handler);
      return () => {
        if (waiting.get(id) === handler) waiting.delete(id);
      };
    },
  };
});

afterAll(() => {
  child.kill();
  stub.stop(true);
});

/** The real sidecar, the real guards: one address in, one read or sentence out. */
function readThrough(url: string): Promise<PageTextAnswer> {
  return fetchPageText(wire, url, 10_000);
}

/** The packet card a wired page reference contributes, as the app builds it. */
function pageCardFacts(on: string, url: string): AskCardFacts {
  return {
    on,
    name: "Rivers",
    state: "current",
    reading: pageReading(on, url, "2026-11-18T12:00:00.000Z"),
    readingText: null,
    note: null,
  };
}

function pageCard(on: string, url: string): AskPacketCard {
  return askCardOf(pageCardFacts(on, url));
}

const THREAD: readonly AskTurn[] = [
  { role: "person", text: "what is this page?", t: "2026-11-18T12:00:00.000Z" },
  { role: "answer", text: "an earlier answer.", t: "2026-11-18T12:01:00.000Z" },
];

describe("which cards the ask opens, and only those", () => {
  test("only a card with a page address is opened, once, in wire order", () => {
    const sources = askPageSources([
      pageCard("rivers", PAGE_URL),
      { name: "a note card", state: null, reading: "some words", note: null },
      pageCard("rivers", PAGE_URL),
      pageCard("rain", MISSING_URL),
    ]);
    expect(sources).toEqual([
      { on: "rivers", url: PAGE_URL },
      { on: "rain", url: MISSING_URL },
    ]);
  });

  test("no page card means no read at all: the fetcher is never called", async () => {
    let calls = 0;
    const cards = await readAskPages(
      [{ name: "a note card", state: null, reading: "words", note: null }],
      async () => {
        calls += 1;
        return { kind: "text", title: "t", text: "never" };
      },
    );
    expect(calls).toBe(0);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.page).toBeUndefined();
  });

  test("a read that throws is the same one sentence, never a lost ask", async () => {
    const cards = await readAskPages([pageCard("rivers", PAGE_URL)], async () => {
      throw new Error("no child");
    });
    expect(cards[0]?.page).toEqual({
      url: PAGE_URL,
      failed: "that page could not be read.",
    });
  });
});

describe("the real sidecar opens the page once per ask, under 16.14's guards", () => {
  test("the fetched text rides, and its block is DECLARED with its size", async () => {
    pageHits = 0;
    thumbHits = 0;
    const wired = [pageCard("rivers", PAGE_URL)];
    const cards = await readAskPages(wired, readThrough);
    // ONE request for this ask, and no thumbnail request: the card already has
    // its picture beside the map, and an extra request would be a second fetch.
    expect(pageHits).toBe(1);
    expect(thumbHits).toBe(0);

    const packet = assembleAskCardPacket(cards, THREAD, "what does the page say?");
    const page = packet.blocks.find((block) => block.kind === "page");
    expect(page).toBeDefined();
    expect(page?.name).toBe(askPageName(PAGE_URL));
    expect(page?.text).toContain(PAGE_BODY);
    expect(page?.text).toContain("the page as it answered when this question was sent:");
    expect(packet.text).toContain(PAGE_BODY);
    // The instruction says which block that is: the LIVE page, not a copy.
    expect(packet.text).toContain("opened when you asked");

    const declared = packet.declaration.blocks.find(
      (block) => block.kind === "page",
    );
    expect(declared?.name).toBe(askPageName(PAGE_URL));
    expect(declared?.size).toBe(utf8ByteLength(page?.text ?? ""));
    expect(packet.declaration.total).toBe(utf8ByteLength(packet.text));
    // The read is whole: the block is never offered as a READ target, because
    // there is no fuller text behind it.
    expect(packet.retrievable).not.toContain(askPageName(PAGE_URL));
    expect(packet.messages).toHaveLength(1);
  });

  test("a THREAD does not re-read the page; the NEXT ask does", async () => {
    pageHits = 0;
    const firstAsk = await readAskPages([pageCard("rivers", PAGE_URL)], readThrough);
    assembleAskCardPacket(firstAsk, THREAD, "and now?");
    // Two turns in the thread plus the card: still ONE page request.
    expect(pageHits).toBe(1);
    // A second question is a second read: the card keeps no copy to stale.
    await readAskPages([pageCard("rivers", PAGE_URL)], readThrough);
    expect(pageHits).toBe(2);
  });

  test("a 404 is ONE citation sentence in the block, and the ask still sends", async () => {
    const cards = await readAskPages(
      [pageCard("gone", MISSING_URL)],
      readThrough,
    );
    expect(cards[0]?.page).toEqual({
      url: MISSING_URL,
      failed: PAGE_SENTENCES.notFound,
    });
    const packet = assembleAskCardPacket(cards, [], "what does the page say?");
    const page = packet.blocks.find((block) => block.kind === "page");
    expect(page?.text).toContain(
      ASK_PACKET_PAGE_UNREAD + PAGE_SENTENCES.notFound,
    );
    // The question and the card still ride; the ask is not lost to the failure.
    expect(packet.messages).toHaveLength(1);
    expect(packet.text).toContain("what does the page say?");
    expect(packet.declaration.blocks.some((block) => block.kind === "page")).toBe(true);
  });
});

describe("the wiring: the ask reads, the map never does", () => {
  test("the ask turn opens the pages BEFORE it assembles the packet", async () => {
    const source = await Bun.file(join(APP_DIR, "src", "canvas", "useGround.ts")).text();
    const read = source.indexOf("await readAskPages(");
    const assemble = source.indexOf("const packet = assembleAskCardPacket(");
    expect(read).toBeGreaterThan(-1);
    expect(assemble).toBeGreaterThan(read);
  });

  test("the card's face imports no fetch: nothing is opened at render", async () => {
    const source = await Bun.file(
      join(APP_DIR, "src", "canvas", "GroundLayer.tsx"),
    ).text();
    expect(source).not.toContain("pageFetch");
    expect(source).not.toContain("readAskPages");
  });
});

describe("the card's face: a thumbnail's grammar, no wall of text", () => {
  const reference: GroundReference = { on: "rivers", name: "Rivers", x: 10, y: 20 };
  const reading: Reading = pageReading("rivers", PAGE_URL, "t");
  const inert = {
    onMove: async () => ({ ok: true as const }),
    onRefresh: async () => ({ ok: true as const }),
    onRemove: async () => ({ ok: true as const }),
  };

  function face(texts: Record<string, string>, mediaTitle: string | null) {
    return renderToStaticMarkup(
      createElement(GroundLayer, {
        references: [reference],
        readings: [reading],
        media:
          mediaTitle === null
            ? []
            : [{ on: "rivers", kind: "page" as const, title: mediaTitle, fetched: "t" }],
        texts,
        states: { rivers: "current" },
        ...inert,
      }),
    );
  }

  test("a NEW page card says what it is, and its empty reading slot says nothing", () => {
    const html = face({ rivers: "" }, "Rain & Rivers");
    expect(html).toContain("Rivers");
    expect(html).toContain("a web page — Rain &amp; Rivers");
    expect(html).toContain(new URL(PAGE_URL).hostname);
    // The absence line belongs to a copy that was never taken, not to a page
    // that is whole as a thumbnail.
    expect(html).not.toContain("the reading text is not here.");
  });

  test("an EXISTING page card keeps and renders the text it already has", () => {
    const html = face({ rivers: PAGE_BODY }, "Rain & Rivers");
    expect(html).toContain(PAGE_BODY);
    expect(html).toContain("a web page — Rain &amp; Rivers");
  });

  test("the declaration says the page will be read before the press", () => {
    expect(askLivePageWords(PAGE_URL)).toContain(PAGE_URL);
    expect(askLivePageWords(PAGE_URL)).toContain(
      "will be read when you send",
    );
  });
});
