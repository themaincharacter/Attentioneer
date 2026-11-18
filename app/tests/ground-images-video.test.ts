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
  thumbLine,
  thumbRequestLine,
  parseRequestLine,
  parseSidecarLine,
  videoLine,
  videoRequestLine,
  type SidecarLine,
  type TurnTransport,
} from "../src/turn/protocol";
import {
  OEMBED_BASE_ENV,
  VIDEO_SENTENCES,
  oembedEndpoint,
  parseOembed,
  videoProviderFor,
  videoUrlProblem,
} from "../src/turn/videoExtract";
import { fetchVideo } from "../src/turn/pageFetch";
import {
  PICK_UNKNOWN,
  pickKindFor,
} from "../src/map/extract";
import {
  IMAGE_NEEDS_SENTENCE,
  IMAGE_PULL_REFUSAL,
  IMAGE_REFRESH_REFUSAL,
  VIDEO_NEEDS_SENTENCE,
  loadReadings,
  parseReadingLine,
  readingNeedsLine,
  readingTextPath,
  refreshReading,
  resolveReadingState,
  serializeReadingLine,
  takeReading,
  videoReading,
  type ReadingIo,
} from "../src/map/readings";
import {
  loadMedia,
  loadThumbSrcs,
  mediaFor,
  parseMedia,
  saveMedia,
  serializeMedia,
  storeThumb,
  type MediaIo,
} from "../src/map/media";
import { addGroundReference, loadGround, saveGround, groundPath } from "../src/map/ground";
import { loadReadings as loadReadingsReal, saveReadings } from "../src/map/readings";
import {
  createFetchedVideo,
  writeVideoCard,
  videoRefusal,
  type VideoIo,
} from "../src/canvas/useGround";
import {
  readingAbsenceLine,
  readingKind,
  readingProvenance,
} from "../src/canvas/GroundLayer";
import { assetSrc } from "../src/canvas/imageSource";
import { renderMirror } from "../src/map/mirror";

/**
 * STORY 16.15 — IMAGES AND VIDEO ARE REFERENCES.
 *
 * Three proofs, different in kind:
 *   - the PURE half: the pick's name decides the extractor, an image's
 *     stat-only reading and its states, the video addresses and the oEmbed
 *     reducer, and the two "needs a model" lines;
 *   - the REAL half: the actual sidecar driven over its actual stdio, with its
 *     oEmbed endpoint aimed at a LOCAL stub (title + thumbnail, an unknown
 *     host, a 500) — no external network, and the app's config is asserted to
 *     grant the asset protocol the image needs;
 *   - the LOCAL-FIRST half: a video card written to a temp workspace, then its
 *     title, picture and reading read back with NO server and NO fetch (the
 *     offline reopen); and a refused read going nowhere near a writer.
 */

const APP_DIR = join(import.meta.dir, "..");
const MAIN = join(APP_DIR, "sidecar", "main.ts");
const BUN = process.execPath;

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";

/* ------------------------------------------------------------------ *
 * A LOCAL oEmbed STUB: the two providers' answers, and a 500.
 * ------------------------------------------------------------------ */

let requests = 0;

const stub = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    requests += 1;
    if (path === "/youtube") {
      return new Response(
        JSON.stringify({
          title: " A Slow River ",
          thumbnail_url: "/thumb.png",
          provider_name: "YouTube",
          type: "video",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (path === "/vimeo") {
      return new Response("the other end is not well", { status: 500 });
    }
    if (path === "/thumb.png") {
      return new Response(Buffer.from(PNG_BASE64, "base64"), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    return new Response("not found", { status: 404 });
  },
});

const OEMBED_BASE = "http://127.0.0.1:" + stub.port;
const YOUTUBE_URL = "https://www.youtube.com/watch?v=river";
const VIMEO_URL = "https://vimeo.com/123456";

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

let child: ReturnType<typeof Bun.spawn>;
let lines: Lines;
let wire: TurnTransport;

beforeAll(() => {
  child = Bun.spawn([BUN, MAIN], {
    cwd: APP_DIR,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, [OEMBED_BASE_ENV]: OEMBED_BASE },
  });
  lines = new Lines(child.stdout as ReadableStream<Uint8Array>);
  wire = transportOf(child, lines);
});

afterAll(() => {
  child.kill();
  stub.stop(true);
});

async function askVideo(url: string): Promise<SidecarLine> {
  const id = Math.floor(Math.random() * 1_000_000) + 1;
  await wire.send(videoRequestLine(id, url));
  // The pipe's buffered queue also holds lines a subscriber already answered
  // for; only THIS id's answer belongs to this ask.
  for (;;) {
    const line = parseSidecarLine(await lines.next());
    if (line === null || line.kind === "hello") continue;
    if (line.id !== id) continue;
    if (line.kind === "video" || line.kind === "error") return line;
  }
}

/* ------------------------------------------------------------------ *
 * A node-fs workspace bridge: the app's writers, without Tauri.
 * ------------------------------------------------------------------ */

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

function metaOf(path: string): {
  kind: "facts";
  exists: boolean;
  is_file: boolean;
  len: number | null;
  modified_ms: number | null;
} {
  try {
    const stat = statSync(path);
    return {
      kind: "facts",
      exists: true,
      is_file: stat.isFile(),
      len: stat.isFile() ? stat.size : null,
      modified_ms: stat.mtimeMs,
    };
  } catch {
    return {
      kind: "facts",
      exists: false,
      is_file: false,
      len: null,
      modified_ms: null,
    };
  }
}

const readingIo: ReadingIo = {
  readTextFile: groundIo.readTextFile,
  writeTextFile: groundIo.writeTextFile,
  createDirAll: async (path: string) => mkdirSync(path, { recursive: true }),
  readTextHead: async () => {
    throw new Error("not used");
  },
  fileMeta: async (path: string) => metaOf(path),
  readFileBytes: async () => ({ kind: "refused" as const, code: "io" as const }),
  pdfText: async () => null,
};

const mediaIo: MediaIo = {
  readTextFile: groundIo.readTextFile,
  writeTextFile: groundIo.writeTextFile,
  createDirAll: async (path: string) => mkdirSync(path, { recursive: true }),
  removeFile: async () => {},
};

const videoIo: VideoIo = {
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
  const workspace = mkdtempSync(join(tmpdir(), "attentioneer-media-"));
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

/** A real PNG on disk, outside the workspace (as an OS pick would be). */
function realImage(): { dir: string; path: string; bytes: number } {
  const dir = mkdtempSync(join(tmpdir(), "attentioneer-image-"));
  const path = join(dir, "photo.png");
  writeFileSync(path, Buffer.from(PNG_BASE64, "base64"));
  return { dir, path, bytes: statSync(path).size };
}

/* ------------------------------------------------------------------ *
 * PURE: the pick's name decides the extractor.
 * ------------------------------------------------------------------ */

describe("the pick's NAME decides which extractor runs", () => {
  test("text, PDF and raster images are named; case never matters", () => {
    expect(pickKindFor("/home/k/notes.txt")).toBe("text");
    expect(pickKindFor("/home/k/notes.md")).toBe("text");
    expect(pickKindFor("/home/k/papers/ATTENTION.PDF")).toBe("pdf");
    expect(pickKindFor("/home/k/photo.png")).toBe("image");
    expect(pickKindFor("/home/k/Photo.JPG")).toBe("image");
    expect(pickKindFor("/home/k/scan.webp")).toBe("image");
    // An SVG is NOT an image here: it could fetch from inside the "local" file.
    expect(pickKindFor("/home/k/drawing.svg")).toBeNull();
  });

  test("a file with no extension is read as text; a named unknown type refuses", () => {
    expect(pickKindFor("/home/k/README")).toBe("text");
    expect(pickKindFor("/home/k/archive.bin")).toBeNull();
    expect(pickKindFor("/home/k/report.docx")).toBeNull();
    expect(pickKindFor("/home/k/.gitignore")).toBe("text");
    expect(PICK_UNKNOWN).toBe("that file is not text, a PDF or an image.");
  });

  test("nothing is sniffed: the bytes are never consulted", () => {
    // The pure classifier takes a PATH only, so no read can happen here.
    expect(pickKindFor.length).toBe(1);
  });

  test("an unknown type refuses through takeReading and writes NOTHING", async () => {
    const workspace = freshWorkspace();
    try {
      const before = snapshot(workspace);
      const result = await takeReading(
        workspace,
        "mystery",
        "/home/k/archive.zip",
        readingIo,
      );
      expect(result).toEqual({ kind: "refused", message: PICK_UNKNOWN });
      expect(snapshot(workspace)).toEqual(before);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ *
 * AN IMAGE: a file reading with no text, drawn where it is.
 * ------------------------------------------------------------------ */

describe("an image is a FILE reading that is never copied", () => {
  test("takeReading stats it, records extract: image, and writes no text", async () => {
    const workspace = freshWorkspace();
    const image = realImage();
    try {
      const taken = await takeReading(
        workspace,
        "river-photo",
        image.path,
        readingIo,
        "2026-11-17T12:00:00.000Z",
      );
      expect(taken.kind).toBe("taken");
      if (taken.kind !== "taken") return;
      expect(taken.text).toBe("");
      expect(taken.reading.extract).toBe("image");
      // A pick outside the workspace is `at` with the absolute value verbatim.
      expect(taken.reading.form).toBe("at");
      expect(taken.reading.from).toBe(image.path);
      expect(taken.reading.bytes).toBe(image.bytes);
      // The line round-trips through the one parser.
      const line = serializeReadingLine(taken.reading);
      expect(line).toContain("| extract: image");
      expect(parseReadingLine(line)).toEqual(taken.reading);
      // NO reading text was written anywhere.
      expect(existsSync(readingTextPath(workspace, "river-photo"))).toBe(false);
      // And NO copy of the image: the workspace holds records only.
      for (const name of readdirSync(workspace)) {
        expect(name).not.toBe("photo.png");
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(image.dir, { recursive: true, force: true });
    }
  });

  test("its state is the ordinary metadata state: current, then missing", async () => {
    const workspace = freshWorkspace();
    const image = realImage();
    try {
      // The stamp is the write's own clock, so the file cannot look "newer".
      const taken = await takeReading(
        workspace,
        "river-photo",
        image.path,
        readingIo,
        new Date().toISOString(),
      );
      if (taken.kind !== "taken") throw new Error("expected a reading");
      expect(
        resolveReadingState(taken.reading, metaOf(image.path), Date.now()),
      ).toBe("current");
      // The file can be moved or deleted — the state says so, with no copy claim.
      rmSync(image.path);
      expect(
        resolveReadingState(taken.reading, metaOf(image.path), Date.now()),
      ).toBe("missing");
      // An image has nothing to re-read: one sentence, nothing written.
      const refreshed = await refreshReading(workspace, taken.reading, readingIo);
      expect(refreshed).toEqual({
        kind: "refused",
        message: IMAGE_REFRESH_REFUSAL,
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(image.dir, { recursive: true, force: true });
    }
  });

  test("the card renders it through the asset protocol, from its own path", () => {
    const source = "asset://localhost/" + encodeURIComponent("/home/k/photo.png");
    expect(assetSrc("/home/k/photo.png")).toBe(source);
    // A Windows pick is encoded with forward slashes, never a raw backslash.
    expect(assetSrc("C:\\Users\\k\\photo.png")).toBe(
      "asset://localhost/" + encodeURIComponent("C:/Users/k/photo.png"),
    );
  });

  test("the app GRANTS the protocol: enabled, scoped, and no new Rust command", () => {
    const config = JSON.parse(
      readFileSync(join(APP_DIR, "src-tauri", "tauri.conf.json"), "utf8"),
    );
    const asset = config.app.security.assetProtocol;
    expect(asset.enable).toBe(true);
    expect(asset.scope.allow).toContain("**");
    expect(asset.scope.allow).toContain("/**");
    expect(asset.scope.deny).toEqual([]);
    // The reasoning JSON cannot carry lives beside it.
    expect(
      existsSync(join(APP_DIR, "src-tauri", "asset-protocol.md")),
    ).toBe(true);
  });

  test("the card's words never claim a reading or a kept copy", () => {
    const reading = {
      on: "river-photo",
      form: "at" as const,
      from: "/home/k/photo.png",
      taken: "2026-11-17T12:00:00.000Z",
      bytes: 70,
      extract: "image" as const,
    };
    expect(readingKind(reading, new Map())).toBe("the image from photo.png");
    expect(readingProvenance(reading, new Map())).toBe("photo.png");
    expect(readingNeedsLine(reading)).toBe(IMAGE_NEEDS_SENTENCE);
    expect(IMAGE_NEEDS_SENTENCE).toBe(
      "this needs a model that can read images.",
    );
    expect(readingAbsenceLine("missing", reading)).toContain("no copy was kept");
    expect(readingAbsenceLine("missing", reading)).toContain("not there");
  });
});

/* ------------------------------------------------------------------ *
 * PURE: video addresses and the oEmbed reducer.
 * ------------------------------------------------------------------ */

describe("a video is a known host read through oEmbed", () => {
  test("YouTube and Vimeo are the two hosts; anything else is null", () => {
    expect(videoProviderFor("https://www.youtube.com/watch?v=a")).toBe("youtube");
    expect(videoProviderFor("https://youtu.be/a")).toBe("youtube");
    expect(videoProviderFor("https://m.youtube.com/watch?v=a")).toBe("youtube");
    expect(videoProviderFor("https://vimeo.com/123")).toBe("vimeo");
    expect(videoProviderFor("https://player.vimeo.com/video/1")).toBe("vimeo");
    expect(videoProviderFor("https://example.com/v/1")).toBeNull();
    expect(videoProviderFor("not a url")).toBeNull();
  });

  test("the address rule is the page's: https, or http on this machine", () => {
    expect(videoUrlProblem("https://www.youtube.com/watch?v=a")).toBeNull();
    expect(videoUrlProblem("http://127.0.0.1:1/x")).toBeNull();
    expect(videoUrlProblem("http://example.com/x")).toBe(
      VIDEO_SENTENCES.insecure,
    );
    expect(videoUrlProblem("file:///etc/passwd")).toBe(
      VIDEO_SENTENCES.badUrl,
    );
  });

  test("an unknown host refuses with ONE sentence suggesting a web page", () => {
    expect(VIDEO_SENTENCES.unsupported).toContain(
      "add it as a web page instead",
    );
    expect(VIDEO_SENTENCES.unsupported.split(";").length).toBe(2);
  });

  test("the endpoint carries the video's address and asks for JSON", () => {
    const endpoint = new URL(oembedEndpoint("youtube", YOUTUBE_URL));
    expect(endpoint.hostname).toBe("www.youtube.com");
    expect(endpoint.pathname).toBe("/oembed");
    expect(endpoint.searchParams.get("url")).toBe(YOUTUBE_URL);
    expect(endpoint.searchParams.get("format")).toBe("json");
    expect(new URL(oembedEndpoint("vimeo", VIMEO_URL)).hostname).toBe(
      "vimeo.com",
    );
    // The proof seam aims the SAME request at a base instead.
    const aimed = new URL(oembedEndpoint("youtube", YOUTUBE_URL, OEMBED_BASE));
    expect(aimed.origin).toBe(OEMBED_BASE);
    expect(aimed.pathname).toBe("/youtube");
  });

  test("the reducer keeps the title and resolves the picture", () => {
    const look = parseOembed(
      JSON.stringify({ title: "  A  Slow\nRiver ", thumbnail_url: "t.png" }),
      "https://example.com/oembed?url=x",
    );
    expect(look).toEqual({
      title: "A Slow River",
      thumbUrl: "https://example.com/t.png",
    });
    expect(parseOembed("not json", "https://x.test/")).toBeNull();
    expect(parseOembed('{"title":""}', "https://x.test/")).toBeNull();
    // A non-http picture is no picture; the title still stands.
    expect(
      parseOembed('{"title":"t","thumbnail_url":"data:image/png;base64,AA"}', "https://x.test/"),
    ).toEqual({ title: "t", thumbUrl: null });
    expect(parseOembed('{"title":"t"}', "https://x.test/")).toEqual({
      title: "t",
      thumbUrl: null,
    });
  });

  test("the wire round-trips a video request and answer", () => {
    expect(parseRequestLine(videoRequestLine(1, YOUTUBE_URL))).toEqual({
      id: 1,
      kind: "video",
      url: YOUTUBE_URL,
    });
    const line = videoLine(2, "A Slow River", "https://x.test/t.png", "youtube", 200);
    expect(parseSidecarLine(line)).toEqual({
      id: 2,
      kind: "video",
      title: "A Slow River",
      thumbUrl: "https://x.test/t.png",
      provider: "youtube",
      http: 200,
    });
    // The video's thumbnail rides the SAME thumb line a page's does.
    expect(parseRequestLine(thumbRequestLine(3, "https://x.test/t.png"))).toEqual({
      id: 3,
      kind: "thumb",
      url: "https://x.test/t.png",
    });
    expect(parseSidecarLine(thumbLine(4, "image/png", "abc", 200))).toEqual({
      id: 4,
      kind: "thumb",
      mime: "image/png",
      data: "abc",
      http: 200,
    });
    expect(parseSidecarLine('{"id":5,"kind":"video","title":"t"}')).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * REAL: the actual sidecar against the local oEmbed stub.
 * ------------------------------------------------------------------ */

describe("the sidecar reads a video's look once, under its stated guards", () => {
  test("a YouTube answer becomes a title and a thumbnail address", async () => {
    const line = await askVideo(YOUTUBE_URL);
    expect(line.kind).toBe("video");
    if (line.kind !== "video") return;
    expect(line.http).toBe(200);
    expect(line.title).toBe("A Slow River");
    expect(line.provider).toBe("youtube");
    expect(line.thumbUrl).toBe(OEMBED_BASE + "/thumb.png");
  });

  test("the window asks once, then the picture through the same thumb wire", async () => {
    const read = await fetchVideo(wire, YOUTUBE_URL, 5_000);
    expect(read.kind).toBe("video");
    if (read.kind !== "video") return;
    expect(read.title).toBe("A Slow River");
    expect(read.provider).toBe("youtube");
    expect(read.thumb).toEqual({ mime: "image/png", base64: PNG_BASE64 });
  });

  test("an unknown host is refused WITHOUT any network call", async () => {
    const before = requests;
    const line = await askVideo("https://example.com/watch/1");
    expect(line).toEqual({
      id: expect.any(Number),
      kind: "error",
      message: VIDEO_SENTENCES.unsupported,
    });
    expect(requests).toBe(before);
  });

  test("a host that answers 500 is ONE sentence", async () => {
    const line = await askVideo(VIMEO_URL);
    expect(line).toEqual({
      id: expect.any(Number),
      kind: "error",
      message: "that video answered 500.",
    });
  });

  test("an insecure remote address is refused before any request", async () => {
    const before = requests;
    const line = await askVideo("http://www.youtube.com/watch?v=a");
    expect(line).toEqual({
      id: expect.any(Number),
      kind: "error",
      message: VIDEO_SENTENCES.insecure,
    });
    expect(requests).toBe(before);
  });
});

/* ------------------------------------------------------------------ *
 * The write order, the offline reopen, and a refused read writing nothing.
 * ------------------------------------------------------------------ */

describe("a video card is copied beside the map and reopens OFFLINE", () => {
  test("picture, media line, reading line, ground line — then a fresh read", async () => {
    const workspace = freshWorkspace();
    try {
      const ground = await loadGround(workspace, groundIo);
      const readings = await loadReadings(workspace, readingIo);
      const media = await loadMedia(workspace, mediaIo);
      const written = await writeVideoCard(
        workspace,
        ground.references,
        readings.readings,
        media.media,
        ground.malformed,
        readings.malformed,
        media.malformed,
        "Slow river",
        10,
        20,
        YOUTUBE_URL,
        { title: "A Slow River", thumb: { mime: "image/png", base64: PNG_BASE64 } },
        "2026-11-17T12:00:00.000Z",
        videoIo,
      );

      // Everything the card needs is IN the workspace; the thumb is a path.
      expect(written.entry.kind).toBe("video");
      expect(written.entry.title).toBe("A Slow River");
      expect(written.entry.thumb).toBe("media/" + written.reading.on + ".svg");
      expect(
        existsSync(join(workspace, "map", "media", written.reading.on + ".svg")),
      ).toBe(true);
      // A video has NO reading text at all.
      expect(
        existsSync(join(workspace, "map", "readings", written.reading.on + ".md")),
      ).toBe(false);

      // OFFLINE REOPEN: fresh reads of the map folder, no server, no fetch.
      const reopened = {
        ground: await loadGround(workspace, groundIo),
        readings: await loadReadings(workspace, readingIo),
        media: await loadMedia(workspace, mediaIo),
      };
      expect(reopened.ground.references).toHaveLength(1);
      expect(reopened.readings.readings[0].form).toBe("url");
      expect(reopened.readings.readings[0].extract).toBe("video");
      const entry = mediaFor(reopened.media.media, reopened.readings.readings[0].on);
      expect(entry?.title).toBe("A Slow River");
      const thumbs = await loadThumbSrcs(workspace, reopened.media.media, mediaIo);
      expect(thumbs[reopened.readings.readings[0].on].startsWith("data:image/svg+xml")).toBe(true);
      expect(thumbs[reopened.readings.readings[0].on]).toContain("iVBORw0KGgo");
      // The record keeps the full address; the card face shows only the host.
      const line = readFileSync(join(workspace, "map", "readings.txt"), "utf8");
      expect(line).toContain(YOUTUBE_URL);
      expect(line).toContain("extract: video");

      // The state rule: current WITH the media line, unread WITHOUT it.
      expect(
        resolveReadingState(
          reopened.readings.readings[0],
          null,
          Date.now(),
          entry !== null,
        ),
      ).toBe("current");
      expect(
        resolveReadingState(
          reopened.readings.readings[0],
          null,
          Date.now(),
          false,
        ),
      ).toBe("unread");

      // The mirror says the video and its host, and claims no transcript.
      const mirror = renderMirror({
        references: reopened.ground.references,
        readings: reopened.readings.readings,
        texts: {},
        states: { [reopened.readings.readings[0].on]: "current" },
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
        sessions: [],
        sessionToolNames: {},
        sessionEndings: {},
        orphanSessionTranscripts: [],
      });
      expect(mirror).toContain("video: www.youtube.com");
      expect(mirror).not.toContain("reading:");
      expect(mirror).not.toContain("/watch?v=");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("the card's words: the title, the host, and what the reading needs", async () => {
    const reading = videoReading("slow-river", YOUTUBE_URL, "t");
    expect(readingKind(reading, new Map(), "A Slow River")).toBe("A Slow River");
    expect(readingKind(reading, new Map(), null)).toBe(
      "the video kept from www.youtube.com",
    );
    expect(readingProvenance(reading, new Map())).toBe("www.youtube.com");
    expect(readingNeedsLine(reading)).toBe(VIDEO_NEEDS_SENTENCE);
    expect(VIDEO_NEEDS_SENTENCE).toBe(
      "the transcript needs a model that can read video.",
    );
    expect(readingAbsenceLine("unread", reading)).toBe(
      "no title or thumbnail was kept for this video.",
    );
  });

  test("a FAILED read writes NOTHING: not one byte, not an empty card", async () => {
    const workspace = freshWorkspace();
    try {
      const before = snapshot(workspace);
      let writers = 0;
      const spyIo: VideoIo = {
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
      const refused = {
        kind: "refused" as const,
        sentence: VIDEO_SENTENCES.notFound,
      };
      const result = await createFetchedVideo(
        workspace,
        [],
        [],
        [],
        [],
        [],
        [],
        "Slow river",
        10,
        20,
        YOUTUBE_URL,
        refused,
        "2026-11-17T12:00:00.000Z",
        spyIo,
      );
      expect(result).toEqual({
        kind: "refused",
        message: VIDEO_SENTENCES.notFound,
      });
      expect(writers).toBe(0);
      expect(snapshot(workspace)).toEqual(before);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("a blank name or address refuses before the read", () => {
    expect(videoRefusal("", YOUTUBE_URL)).toBe("name it first.");
    expect(videoRefusal("Slow river", "  ")).toBe(
      "paste a video's address first.",
    );
    expect(videoRefusal("Slow river", YOUTUBE_URL)).toBeNull();
  });

  test("an image reads back after a reopen with no server and no copy", async () => {
    const workspace = freshWorkspace();
    const image = realImage();
    try {
      const taken = await takeReading(
        workspace,
        "photo",
        image.path,
        readingIo,
        new Date().toISOString(),
      );
      if (taken.kind !== "taken") throw new Error("expected a reading");
      await saveReadings(workspace, [taken.reading], [], readingIo);
      await saveGround(
        workspace,
        [addGroundReference([], "Photo", 10, 20).reference],
        [],
        groundIo,
      );
      // The image is still beyond the app's reach, exactly where it was.
      expect(assetSrc(taken.reading.form === "at" ? taken.reading.from : image.path)).toContain("asset://localhost/");
      const reopened = {
        ground: await loadGround(workspace, groundIo),
        readings: await loadReadingsReal(workspace, readingIo),
      };
      expect(reopened.readings.readings[0].extract).toBe("image");
      expect(reopened.readings.readings[0].from).toBe(image.path);
      expect(
        resolveReadingState(
          reopened.readings.readings[0],
          metaOf(image.path),
          Date.now(),
        ),
      ).toBe("current");
      // No text file, no copy: the workspace is records only.
      expect(
        existsSync(join(workspace, "map", "readings", "photo.md")),
      ).toBe(false);
      expect(snapshot(workspace)[image.path]).toBeUndefined();
      // The ground file is the only card record; the image is not in it.
      expect(readFileSync(groundPath(workspace), "utf8")).not.toContain(
        "photo.png",
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(image.dir, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ *
 * The map's own rules still hold.
 * ------------------------------------------------------------------ */

describe("nothing new is rendered or counted", () => {
  test("the ground level still renders no map content", async () => {
    const rules = await import("../src/canvas/mapContentRules");
    expect(rules.renderedMapContent("ground")).toEqual([]);
  });

  test("a video's media line round-trips, and a remote thumb is refused", () => {
    const entry = {
      on: "slow-river",
      kind: "video" as const,
      title: "A Slow River",
      thumb: "media/slow-river.svg",
      fetched: "2026-11-17T12:00:00.000Z",
    };
    expect(parseMedia(serializeMedia([entry])).media).toEqual([entry]);
    expect(
      parseMedia(
        '{"on":"v","kind":"video","title":"t","thumb":"https://x.test/a.png","fetched":"t"}',
      ).media,
    ).toEqual([]);
    expect(IMAGE_PULL_REFUSAL).toBe("an image has no text to read more of.");
  });
});
