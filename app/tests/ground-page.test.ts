import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  pageRequestLine,
  pageLine,
  parseRequestLine,
  parseSidecarLine,
  thumbLine,
  thumbRequestLine,
  type SidecarLine,
  type TurnTransport,
} from "../src/turn/protocol";
import {
  PAGE_MAX_BODY_BYTES,
  PAGE_SENTENCES,
  capTextBytes,
  extractPage,
  pageTitle,
  pageUrlProblem,
  readableText,
  thumbnailUrl,
} from "../src/turn/pageExtract";
import { fetchPage } from "../src/turn/pageFetch";
import {
  READING_MAX_BYTES,
  cappedReadingText,
  isWebUrl,
  pageHost,
  pageReading,
  parseReadingLine,
  resolveReadingState,
  serializeReadingLine,
  storeReadingText,
  type ReadingIo,
} from "../src/map/readings";
import {
  loadMedia,
  loadThumbSrcs,
  mediaFor,
  mediaPath,
  parseMedia,
  saveMedia,
  serializeMedia,
  storeThumb,
  thumbRelPath,
  thumbSvg,
  withMedia,
  type MediaIo,
} from "../src/map/media";
import { loadGround, saveGround } from "../src/map/ground";
import { loadReadings, saveReadings } from "../src/map/readings";
import {
  createFetchedPage,
  pageRefusal,
  writePageCard,
  type PageIo,
} from "../src/canvas/useGround";
import { readingKind, readingProvenance } from "../src/canvas/GroundLayer";
import { renderMirror } from "../src/map/mirror";
import { groundPath } from "../src/map/ground";

/**
 * STORY 16.14 — A WEB PAGE IS A REFERENCE.
 *
 * Three proofs, different in kind:
 *   - the PURE half: the address guards, the dependency-free reducer, the url
 *     reading's state, and the media record's parse/serialize;
 *   - the REAL half: the actual `sidecar/main.ts` driven over its actual stdio
 *     against a LOCAL stub page server (title, thumbnail, 404, a PDF body, an
 *     enormous body, a redirect chain) — no external network;
 *   - the LOCAL-FIRST half: a page card written to a temp workspace, then the
 *     title, text and image read back with NO server and NO fetch, which is the
 *     offline reopen; and a refused fetch going nowhere near a writer.
 */

const APP_DIR = join(import.meta.dir, "..");
const MAIN = join(APP_DIR, "sidecar", "main.ts");
const BUN = process.execPath;

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";

const PAGE_HTML =
  "<!doctype html><html><head>" +
  "<title> Rain &amp; Rivers </title>" +
  "<style>body { color: red; }</style>" +
  '<meta property="og:image" content="/thumb.png">' +
  "</head><body>" +
  "<script>window.bad = true;</script>" +
  "<h1>Rivers</h1><p>Every <b>river</b> is a slow argument.</p>" +
  "<p>A gauge reads the &lt;water&gt; level.</p>" +
  "</body></html>";

const EMPTY_HTML =
  "<html><head><title>Nothing</title></head><body><script>x()</script></body></html>";

let requests = 0;

const stub = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    requests += 1;
    if (path === "/page" || path === "/redirect") {
      if (path === "/redirect") {
        return new Response(null, { status: 302, headers: { location: "/page" } });
      }
      return new Response(PAGE_HTML, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (path === "/thumb.png") {
      return new Response(Buffer.from(PNG_BASE64, "base64"), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    if (path === "/missing") return new Response("gone", { status: 404 });
    if (path === "/document.pdf") {
      return new Response("%PDF-1.7 not html", {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    }
    if (path === "/huge") {
      return new Response("x".repeat(PAGE_MAX_BODY_BYTES + 1024), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (path === "/empty") {
      return new Response(EMPTY_HTML, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (path === "/loop") {
      return new Response(null, { status: 302, headers: { location: "/loop" } });
    }
    if (path === "/plain") {
      return new Response("a plain text answer, not a page", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }
    return new Response("not found", { status: 404 });
  },
});

const PAGE_URL = `http://127.0.0.1:${stub.port}/page`;

/* ------------------------------------------------------------------ *
 * The pipe: one child, buffered lines, one subscriber by id.
 * ------------------------------------------------------------------ */

class Lines {
  private buffer = "";
  private ready: string[] = [];
  private waiting: (() => void)[] = [];
  private closed = false;
  private handlers: ((line: string) => void)[] = [];

  constructor(stream: ReadableStream<Uint8Array>) {
    const decoder = new TextDecoder();
    void (async () => {
      for await (const chunk of stream) {
        this.buffer += decoder.decode(chunk, { stream: true });
        let newline = this.buffer.indexOf("\n");
        while (newline >= 0) {
          const line = this.buffer.slice(0, newline);
          this.buffer = this.buffer.slice(newline + 1);
          this.ready.push(line);
          for (const handler of this.handlers) handler(line);
          this.waiting.shift()?.();
          newline = this.buffer.indexOf("\n");
        }
      }
      this.closed = true;
      while (this.waiting.length > 0) this.waiting.shift()?.();
    })();
  }

  onLine(handler: (line: string) => void): void {
    this.handlers.push(handler);
  }

  async next(budgetMs = 5_000): Promise<string> {
    const deadline = Date.now() + budgetMs;
    while (this.ready.length === 0) {
      if (this.closed) throw new Error("the sidecar closed before answering");
      if (Date.now() >= deadline) throw new Error("timed out waiting for a line");
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve);
        setTimeout(resolve, 10);
      });
    }
    return this.ready.shift() as string;
  }
}

function transportOf(
  child: ReturnType<typeof Bun.spawn>,
  lines: Lines,
): TurnTransport {
  const waiting = new Map<number, (line: SidecarLine) => void>();
  lines.onLine((raw) => {
    const line = parseSidecarLine(raw);
    if (line === null || line.kind === "hello") return;
    waiting.get(line.id)?.(line);
  });
  return {
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
}

/** A whole-file node-fs workspace bridge: the app's writers, without Tauri. */
const groundIo = {
  readTextFile: async (path: string): Promise<string | null> => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  writeTextFile: async (path: string, content: string): Promise<void> => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  },
};

const readingIo: ReadingIo = {
  readTextFile: groundIo.readTextFile,
  writeTextFile: groundIo.writeTextFile,
  createDirAll: async (path: string) => mkdirSync(path, { recursive: true }),
  readTextHead: async () => {
    throw new Error("not used");
  },
  fileMeta: async () => ({ kind: "refused" as const }),
  readFileBytes: async () => ({ kind: "refused" as const, code: "io" as const }),
  pdfText: async () => null,
};

const mediaIo: MediaIo = {
  readTextFile: groundIo.readTextFile,
  writeTextFile: groundIo.writeTextFile,
  createDirAll: async (path: string) => mkdirSync(path, { recursive: true }),
  removeFile: async () => {},
};

const pageIo: PageIo = {
  storeReadingText: (workspace, on, text) =>
    storeReadingText(workspace, on, text, readingIo),
  saveReadings: (workspace, readings, malformed) =>
    saveReadings(workspace, readings, malformed ?? [], readingIo),
  saveMedia: (workspace, media, malformed) =>
    saveMedia(workspace, media, malformed ?? [], mediaIo),
  storeThumb: (workspace, slug, mime, base64) =>
    storeThumb(workspace, slug, mime, base64, mediaIo),
  saveGround: (workspace, references, malformed) =>
    saveGround(workspace, references, malformed ?? [], groundIo),
};

function freshWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), "attentioneer-page-"));
  mkdirSync(join(workspace, "map"), { recursive: true });
  return workspace;
}

function snapshot(workspace: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else out[path] = readFileSync(path, "base64");
    }
  };
  walk(workspace);
  return out;
}

/* ------------------------------------------------------------------ *
 * PURE: the address, the reducer and the record.
 * ------------------------------------------------------------------ */

describe("the address rule is the provider rows' rule", () => {
  test("https anywhere; http only on this machine", () => {
    expect(pageUrlProblem("https://example.com/a")).toBeNull();
    expect(pageUrlProblem("http://127.0.0.1:1234/page")).toBeNull();
    expect(pageUrlProblem("http://localhost:1234/")).toBeNull();
    expect(pageUrlProblem("http://[::1]:1234/")).toBeNull();
    expect(pageUrlProblem("http://example.com/page")).toBe(
      PAGE_SENTENCES.insecure,
    );
    expect(pageUrlProblem("file:///etc/passwd")).toBe(PAGE_SENTENCES.badUrl);
    expect(pageUrlProblem("not a url")).toBe(PAGE_SENTENCES.badUrl);
  });
});

describe("the reducer is dependency-free and says what the page says", () => {
  test("title, readable text, and no script or style words", () => {
    const extracted = extractPage(PAGE_HTML, PAGE_URL);
    expect(extracted).not.toBeNull();
    expect(extracted!.title).toBe("Rain & Rivers");
    expect(extracted!.text).toContain("Rivers");
    expect(extracted!.text).toContain("Every river is a slow argument.");
    expect(extracted!.text).toContain("A gauge reads the <water> level.");
    expect(extracted!.text).not.toContain("window.bad");
    expect(extracted!.text).not.toContain("color: red");
    expect(extracted!.thumbUrl).toBe(`http://127.0.0.1:${stub.port}/thumb.png`);
  });

  test("empty after stripping is null — the caller refuses, never an empty reading", () => {
    expect(readableText(EMPTY_HTML)).toBe("");
    expect(extractPage(EMPTY_HTML, PAGE_URL)).toBeNull();
  });

  test("the title falls back to nothing, and the thumbnail resolves absolutely", () => {
    expect(pageTitle("<html><body>no head</body></html>")).toBe("");
    expect(
      thumbnailUrl('<meta name="twitter:image" content="a.png">', "https://x.test/p"),
    ).toBe("https://x.test/a.png");
    expect(thumbnailUrl("<html></html>", "https://x.test/p")).toBeNull();
  });

  test("the text cap is bytes, not a wish", () => {
    const capped = capTextBytes("é".repeat(100), 10);
    expect(new TextEncoder().encode(capped).byteLength).toBeLessThanOrEqual(10);
  });
});

describe("the url reading and its media record", () => {
  test("a page line round-trips, verbatim url and extract: page", () => {
    const reading = pageReading("rivers", "https://example.com/a?b=1#c", "2026-11-17T12:00:00.000Z");
    expect(serializeReadingLine(reading)).toBe(
      "on: rivers | form: url | from: https://example.com/a?b=1#c | taken: 2026-11-17T12:00:00.000Z | extract: page",
    );
    expect(parseReadingLine(serializeReadingLine(reading))).toEqual(reading);
    expect(isWebUrl("https://example.com")).toBe(true);
    expect(isWebUrl("notes/a.txt")).toBe(false);
  });

  test("a url reading is NEVER missing: current once taken, no stat", () => {
    const reading = pageReading("rivers", "https://example.com/", "2026-11-17T12:00:00.000Z");
    expect(resolveReadingState(reading, null, Date.now())).toBe("current");
    expect(
      resolveReadingState(reading, { kind: "refused" } as never, Date.now()),
    ).toBe("current");
  });

  test("the card's kind is the title; the footer is the HOST only", () => {
    const reading = pageReading("rivers", "https://example.com/a/b?q=1", "t");
    expect(readingKind(reading, new Map(), "Rain & Rivers")).toBe(
      "Rain & Rivers",
    );
    expect(readingKind(reading, new Map(), null)).toBe(
      "the page kept from example.com",
    );
    expect(readingProvenance(reading, new Map())).toBe("example.com");
    expect(readingProvenance(reading, new Map())).not.toContain("/a/b");
  });

  test("the media line round-trips; a remote thumb is malformed", () => {
    const entry = {
      on: "rivers",
      kind: "page" as const,
      title: "Rain & Rivers",
      thumb: thumbRelPath("rivers"),
      fetched: "2026-11-17T12:00:00.000Z",
    };
    expect(parseMedia(serializeMedia([entry])).media).toEqual([entry]);
    expect(
      parseMedia(
        '{"on":"r","kind":"page","title":"t","thumb":"https://x.test/a.png","fetched":"t"}',
      ).media,
    ).toEqual([]);
    expect(
      parseMedia('{"on":"r","kind":"page","title":"t","thumb":"../x.png","fetched":"t"}')
        .malformed,
    ).toHaveLength(1);
    expect(withMedia([], entry)).toEqual([entry]);
  });

  test("the SVG wrapper embeds the image and renders as a local data URL", async () => {
    const svg = thumbSvg("image/png", PNG_BASE64);
    expect(svg).toContain("data:image/png;base64,");
    // The only http is the SVG namespace; the image is a data URL.
    expect(svg).not.toContain('href="http');
    const workspace = freshWorkspace();
    try {
      const thumb = await storeThumb(
        workspace,
        "rivers",
        "image/png",
        PNG_BASE64,
        mediaIo,
      );
      const media = [{ on: "rivers", kind: "page" as const, title: "t", thumb, fetched: "t" }];
      const thumbs = await loadThumbSrcs(workspace, media, mediaIo);
      expect(thumbs.rivers.startsWith("data:image/svg+xml")).toBe(true);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ *
 * REAL: the actual sidecar against a local stub page server.
 * ------------------------------------------------------------------ */

let child: ReturnType<typeof Bun.spawn>;
let lines: Lines;
let wire: TurnTransport;

beforeAll(() => {
  child = Bun.spawn([BUN, MAIN], {
    cwd: APP_DIR,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  lines = new Lines(child.stdout as ReadableStream<Uint8Array>);
  wire = transportOf(child, lines);
});

afterAll(() => {
  child.kill();
  stub.stop(true);
});

async function ask(url: string): Promise<SidecarLine> {
  const id = Math.floor(Math.random() * 1_000_000) + 1;
  await wire.send(pageRequestLine(id, url));
  for (;;) {
    const line = parseSidecarLine(await lines.next());
    if (line === null || line.kind === "hello") continue;
    if (line.kind === "page" || line.kind === "error") return line;
  }
}

describe("the sidecar fetches once, under its stated guards", () => {
  test("an HTML page comes back as title + extracted text + a thumbnail address", async () => {
    const line = await ask(PAGE_URL);
    expect(line.kind).toBe("page");
    if (line.kind !== "page") return;
    expect(line.http).toBe(200);
    expect(line.title).toBe("Rain & Rivers");
    expect(line.text).toContain("Every river is a slow argument.");
    expect(line.text).not.toContain("window.bad");
    expect(line.thumbUrl).toBe(`http://127.0.0.1:${stub.port}/thumb.png`);
  });

  test("the thumbnail is fetched through the SAME pipe and carried as base64", async () => {
    const line = await ask(PAGE_URL);
    if (line.kind !== "page") throw new Error("page read failed");
    const id = 4242;
    await wire.send(thumbRequestLine(id, line.thumbUrl!));
    let thumb: SidecarLine | null = null;
    for (let i = 0; i < 5; i += 1) {
      const next = parseSidecarLine(await lines.next());
      if (next === null || next.kind === "hello") continue;
      thumb = next;
      break;
    }
    expect(thumb?.kind).toBe("thumb");
    if (thumb?.kind === "thumb") {
      expect(thumb.mime).toBe("image/png");
      expect(Buffer.from(thumb.data, "base64").toString("base64")).toBe(
        PNG_BASE64,
      );
    }
  });

  test("a redirect chain is followed, and the final page is read", async () => {
    const line = await ask(`http://127.0.0.1:${stub.port}/redirect`);
    expect(line.kind).toBe("page");
    if (line.kind === "page") expect(line.title).toBe("Rain & Rivers");
  });

  test("a 404 is ONE sentence and no page", async () => {
    const line = await ask(`http://127.0.0.1:${stub.port}/missing`);
    expect(line).toEqual({ id: expect.any(Number), kind: "error", message: PAGE_SENTENCES.notFound });
  });

  test("a PDF body is refused with the add-it-as-that-kind sentence", async () => {
    const line = await ask(`http://127.0.0.1:${stub.port}/document.pdf`);
    expect(line.kind).toBe("error");
    if (line.kind === "error") {
      expect(line.message).toBe(PAGE_SENTENCES.notPage);
      expect(line.message).toContain("add it as the file or image it is instead");
    }
  });

  test("an enormous body is refused before it is read whole", async () => {
    const line = await ask(`http://127.0.0.1:${stub.port}/huge`);
    expect(line).toEqual({ id: expect.any(Number), kind: "error", message: PAGE_SENTENCES.tooLarge });
  });

  test("a redirect loop refuses after the bound", async () => {
    const line = await ask(`http://127.0.0.1:${stub.port}/loop`);
    expect(line).toEqual({
      id: expect.any(Number),
      kind: "error",
      message: PAGE_SENTENCES.tooManyRedirects,
    });
  });

  test("an empty extraction refuses with one sentence, never an empty page", async () => {
    const line = await ask(`http://127.0.0.1:${stub.port}/empty`);
    expect(line).toEqual({ id: expect.any(Number), kind: "error", message: PAGE_SENTENCES.noText });
  });

  test("plain text is readable as a page", async () => {
    const line = await ask(`http://127.0.0.1:${stub.port}/plain`);
    expect(line.kind).toBe("page");
    if (line.kind === "page") expect(line.text).toContain("plain text answer");
  });

  test("a remote plain-http address is refused WITHOUT any network call", async () => {
    const before = requests;
    const line = await ask("http://example.com/");
    expect(line).toEqual({
      id: expect.any(Number),
      kind: "error",
      message: PAGE_SENTENCES.insecure,
    });
    expect(requests).toBe(before);
  });
});

/* ------------------------------------------------------------------ *
 * The window seam, the write order, the offline read.
 * ------------------------------------------------------------------ */

describe("the window seam asks once and treats a failed thumb as no picture", () => {
  test("a page line and its thumb line become one read", async () => {
    const sent: string[] = [];
    const answers = new Map<number, SidecarLine>();
    const transport: TurnTransport = {
      async send(line) {
        sent.push(line);
        const request = JSON.parse(line);
        answers.set(
          request.id,
          request.kind === "page"
            ? {
                id: request.id,
                kind: "page",
                title: "t",
                text: "some words",
                thumbUrl: "https://example.com/i.png",
                http: 200,
              }
            : { id: request.id, kind: "thumb", mime: "image/png", data: PNG_BASE64, http: 200 },
        );
        queueMicrotask(() => handler?.(answers.get(request.id)!));
      },
      subscribe(id, callback) {
        handler = callback;
        return () => {
          handler = null;
        };
      },
    };
    let handler: ((line: SidecarLine) => void) | null = null;
    const read = await fetchPage(transport, "https://example.com", 1_000);
    expect(read.kind).toBe("page");
    if (read.kind === "page") {
      expect(read.title).toBe("t");
      expect(read.thumb).toEqual({ mime: "image/png", base64: PNG_BASE64 });
    }
    expect(sent).toHaveLength(2);
  });

  test("a thumb error is silence, not a failed page", async () => {
    let handler: ((line: SidecarLine) => void) | null = null;
    const transport: TurnTransport = {
      async send(line) {
        const request = JSON.parse(line);
        queueMicrotask(() => {
          if (request.kind === "page") {
            handler?.({
              id: request.id,
              kind: "page",
              title: "t",
              text: "words",
              thumbUrl: "https://example.com/i.png",
              http: 200,
            });
          } else {
            handler?.({
              id: request.id,
              kind: "error",
              message: "that image could not be taken.",
            });
          }
        });
      },
      subscribe(_id, callback) {
        handler = callback;
        return () => {
          handler = null;
        };
      },
    };
    const read = await fetchPage(transport, "https://example.com", 1_000);
    expect(read.kind).toBe("page");
    if (read.kind === "page") expect(read.thumb).toBeNull();
  });
});

describe("a page card is copied beside the map and reopens OFFLINE", () => {
  test("text, reading line, local thumb, media line, ground line — and no fetch at reopen", async () => {
    const workspace = freshWorkspace();
    try {
      const ground = await loadGround(workspace, groundIo);
      const readings = await loadReadings(workspace, readingIo);
      const media = await loadMedia(workspace, mediaIo);
      const written = await writePageCard(
        workspace,
        ground.references,
        readings.readings,
        media.media,
        ground.malformed,
        readings.malformed,
        media.malformed,
        "Rivers",
        10,
        20,
        PAGE_URL,
        {
          title: "Rain & Rivers",
          text: "Every river is a slow argument.",
          thumb: { mime: "image/png", base64: PNG_BASE64 },
        },
        "2026-11-17T12:00:00.000Z",
        pageIo,
      );

      // Everything the card needs is IN the workspace; the thumb is a path.
      expect(written.entry.title).toBe("Rain & Rivers");
      expect(written.entry.thumb).toBe("media/rivers.svg");
      expect(existsSync(join(workspace, "map", "media", "rivers.svg"))).toBe(true);
      expect(existsSync(join(workspace, "map", "readings", "rivers.md"))).toBe(true);

      // OFFLINE REOPEN: a fresh READ, no server and no fetch anywhere.
      const reopened = {
        ground: await loadGround(workspace, groundIo),
        readings: await loadReadings(workspace, readingIo),
        media: await loadMedia(workspace, mediaIo),
      };
      expect(reopened.ground.references.map((r) => r.on)).toEqual(["rivers"]);
      expect(reopened.readings.readings.map((r) => r.form)).toEqual(["url"]);
      const entry = mediaFor(reopened.media.media, "rivers");
      expect(entry?.title).toBe("Rain & Rivers");
      const thumbs = await loadThumbSrcs(workspace, reopened.media.media, mediaIo);
      expect(thumbs.rivers.startsWith("data:image/svg+xml")).toBe(true);
      expect(thumbs.rivers).toContain("iVBORw0KGgo");
      expect(readFileSync(join(workspace, "map", "readings", "rivers.md"), "utf8")).toBe(
        "Every river is a slow argument.",
      );
      // The full URL stays a record; the card face never shows it.
      const line = readFileSync(join(workspace, "map", "readings.txt"), "utf8");
      expect(line).toContain(PAGE_URL);
      expect(line).toContain("extract: page");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("a FAILED fetch writes NOTHING: not one byte, not an empty card", async () => {
    const workspace = freshWorkspace();
    try {
      const before = snapshot(workspace);
      let writers = 0;
      const spyIo: PageIo = {
        storeReadingText: async () => {
          writers += 1;
        },
        saveReadings: async () => {
          writers += 1;
        },
        saveMedia: async () => {
          writers += 1;
        },
        storeThumb: async () => {
          writers += 1;
          return "";
        },
        saveGround: async () => {
          writers += 1;
        },
      };
      const refused = { kind: "refused" as const, sentence: PAGE_SENTENCES.notFound };
      const result = await createFetchedPage(
        workspace,
        [],
        [],
        [],
        [],
        [],
        [],
        "Rivers",
        10,
        20,
        "http://127.0.0.1:1/missing",
        refused,
        "2026-11-17T12:00:00.000Z",
        spyIo,
      );
      expect(result).toEqual({ kind: "refused", message: PAGE_SENTENCES.notFound });
      expect(writers).toBe(0);
      expect(snapshot(workspace)).toEqual(before);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("a blank name or address refuses before the fetch", async () => {
    expect(pageRefusal("", PAGE_URL)).toBe("name it first.");
    expect(pageRefusal("Rivers", "  ")).toBe(
      "paste a web page's address first.",
    );
    expect(pageRefusal("Rivers", PAGE_URL)).toBeNull();
  });

  test("the reading text is capped by the reading's own provisional bound", () => {
    const text = cappedReadingText("line\n".repeat(500));
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(
      READING_MAX_BYTES,
    );
    expect(text.split("\n").length).toBeLessThanOrEqual(66);
  });
});

describe("the wire and the record agree", () => {
  test("page and thumb requests and answers round-trip through the readers", () => {
    expect(parseRequestLine(pageRequestLine(1, PAGE_URL))).toEqual({
      id: 1,
      kind: "page",
      url: PAGE_URL,
    });
    expect(parseRequestLine(thumbRequestLine(2, "https://x.test/i.png"))).toEqual({
      id: 2,
      kind: "thumb",
      url: "https://x.test/i.png",
    });
    expect(
      parseSidecarLine(pageLine(3, "t", "words", null, 200)),
    ).toEqual({ id: 3, kind: "page", title: "t", text: "words", thumbUrl: null, http: 200 });
    expect(parseSidecarLine(thumbLine(4, "image/png", "abc", 200))).toEqual({
      id: 4,
      kind: "thumb",
      mime: "image/png",
      data: "abc",
      http: 200,
    });
    expect(parseSidecarLine('{"id":5,"kind":"page"}')).toBeNull();
  });

  test("the map still renders no content on the ground level", async () => {
    const rules = await import("../src/canvas/mapContentRules");
    expect(rules.renderedMapContent("ground")).toEqual([]);
  });

  test("the mirror names a page's HOST, never its full address", () => {
    const render = renderMirror({
      references: [{ on: "rivers", name: "Rivers", x: 0, y: 0 }],
      readings: [
        pageReading("rivers", "https://example.com/a/b?q=1", "2026-11-17T12:00:00.000Z"),
      ],
      texts: { rivers: "Every river is a slow argument." },
      states: { rivers: "current" },
      notes: {},
      orphanNotes: [],
      orphanMedia: [],
      links: [],
      orphanLinks: [],
      malformedGround: [],
      malformedReadings: [],
      malformedLinks: [],
      asks: [],
      malformedAsks: [],
      orphanAskTurns: [],
    } as never);
    expect(render).toContain("page: example.com");
    expect(render).not.toContain("/a/b");
  });

  test("the media file lives beside the ground records", () => {
    expect(mediaPath("/w")).toBe("/w/map/media.jsonl");
    expect(groundPath("/w")).toBe("/w/map/ground.txt");
  });
});
