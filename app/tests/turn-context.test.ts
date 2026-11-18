import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TextHead } from "../src/lib/fs";
import { NOTE_PREVIEW_LINES } from "../src/map/notes";
import {
  READING_MAX_BYTES,
  READING_MAX_LINES,
  READING_PREVIEW_LINES,
  type Reading,
} from "../src/map/readings";
import { PULL_BUDGET_BYTES, type PullIo } from "../src/map/pull";
import {
  fetchAskBlock,
  readAskContext,
  type AskContextDeps,
} from "../src/turn/context";

/**
 * Story 15.3 — READING THE PACKET'S PREVIEWS.
 *
 * The one new IO must be bounded and honest: only the INCLUDED reaches are
 * read, the head reader's existing caps are the only ones used, a url is never
 * fetched, a boundary escape reads nothing, the card's crops are the existing
 * ones, and the one follow-up reads the pull budget and nothing wider. The
 * reader writes NOTHING (its bridge surface has no writer at all).
 */

const APP = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(APP, "src");

function source(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

/** The code without its comments: the doc may NAME what the code never does. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const WS = "/ws";

interface Fake {
  deps: AskContextDeps;
  reads: { path: string; maxLines: number; maxBytes: number }[];
  pulls: { path: string; budget: number }[];
}

function fake(options: {
  heads?: Record<string, string>;
  canonical?: (path: string) => string | null;
  pulled?: { text: string } | "refused";
} = {}): Fake {
  const reads: Fake["reads"] = [];
  const pulls: Fake["pulls"] = [];
  const heads = options.heads ?? {};
  const deps: AskContextDeps = {
    async readTextHead(path, maxLines, maxBytes): Promise<TextHead> {
      reads.push({ path, maxLines, maxBytes });
      const head = heads[path];
      return {
        head: head ?? "",
        truncated: false,
        exists: head !== undefined,
        size: head === undefined ? null : head.length,
        mtime: null,
        decode: "clean",
      };
    },
    canonicalize: async (path) => options.canonical?.(path) ?? path,
    async pull(_workspacePath, reading, budget) {
      pulls.push({ path: reading.from, budget });
      if (options.pulled === "refused" || options.pulled === undefined) {
        return { kind: "refused", message: "that file is not there." };
      }
      return { kind: "text", text: options.pulled.text, truncated: false };
    },
    pullIo: {} as PullIo,
  };
  return { deps, reads, pulls };
}

const CARD_READING: Reading = {
  on: "rain",
  form: "path",
  from: "notes/card.md",
  taken: "2026-01-01T00:00:00.000Z",
  bytes: 100,
};

function cardFacts(overrides: Record<string, unknown> = {}) {
  return {
    name: "rain",
    state: "changed" as const,
    reading: CARD_READING,
    readingText: "one\ntwo\nthree",
    note: "my note",
    ...overrides,
  };
}

describe("only the INCLUDED reaches are read", () => {
  test("an included path is read once; a reach that did not include is not", async () => {
    const f = fake({ heads: { [WS + "/notes/in.md"]: "the head" } });
    const context = await readAskContext(
      {
        workspacePath: WS,
        card: cardFacts(),
        included: [{ form: "path", value: "notes/in.md" }],
      },
      f.deps,
    );
    expect(f.reads).toHaveLength(1);
    expect(f.reads[0].path).toBe(WS + "/notes/in.md");
    expect(context.reaches).toEqual([
      { form: "path", value: "notes/in.md", preview: "the head" },
    ]);
    expect(context.retrievable).toEqual(["rain", "path notes/in.md"]);
    expect(context.sources.map((entry) => entry.name)).toEqual([
      "rain",
      "path notes/in.md",
    ]);
  });

  test("the head reader's existing caps are the only ones used", async () => {
    const f = fake({ heads: { [WS + "/notes/in.md"]: "head" } });
    await readAskContext(
      {
        workspacePath: WS,
        card: cardFacts(),
        included: [{ form: "path", value: "notes/in.md" }],
      },
      f.deps,
    );
    expect(f.reads[0].maxLines).toBe(READING_MAX_LINES);
    expect(f.reads[0].maxBytes).toBe(READING_MAX_BYTES);
  });

  test("a url is named as a citation only: never fetched, never retrievable", async () => {
    const f = fake();
    const context = await readAskContext(
      {
        workspacePath: WS,
        card: cardFacts(),
        included: [{ form: "url", value: "https://example.org/chat" }],
      },
      f.deps,
    );
    expect(f.reads).toEqual([]);
    expect(context.reaches).toEqual([
      { form: "url", value: "https://example.org/chat", preview: null },
    ]);
    expect(context.retrievable).toEqual(["rain"]);
  });

  test("an at form is read as it stands (the machine-local exception)", async () => {
    const f = fake({ heads: { "/home/k/x.md": "x head" } });
    const context = await readAskContext(
      {
        workspacePath: WS,
        card: cardFacts(),
        included: [{ form: "at", value: "/home/k/x.md" }],
      },
      f.deps,
    );
    expect(f.reads[0].path).toBe("/home/k/x.md");
    expect(context.reaches[0].preview).toBe("x head");
  });

  test("a boundary escape reads nothing and still cites the reach", async () => {
    const f = fake({
      heads: { "/elsewhere/out.md": "secret" },
      canonical: (path) => (path.includes("..") ? "/elsewhere/out.md" : path),
    });
    const context = await readAskContext(
      {
        workspacePath: WS,
        card: cardFacts(),
        included: [{ form: "path", value: "../out.md" }],
      },
      f.deps,
    );
    expect(f.reads).toEqual([]);
    expect(context.reaches[0].preview).toBeNull();
    // The citation still rides, but there is no fuller read to offer.
    expect(context.retrievable).toEqual(["rain"]);
  });

  test("a missing target is a citation without a preview, never invented", async () => {
    const f = fake();
    const context = await readAskContext(
      {
        workspacePath: WS,
        card: cardFacts(),
        included: [{ form: "path", value: "notes/gone.md" }],
      },
      f.deps,
    );
    expect(context.reaches[0].preview).toBeNull();
  });
});

describe("the card's crops are the existing ones", () => {
  test("reading is the 6-line crop with one ellipsis; note is the 2-line crop", async () => {
    const lines = Array.from({ length: 10 }, (_value, index) => "line " + index);
    const context = await readAskContext(
      {
        workspacePath: WS,
        card: cardFacts({
          reading: CARD_READING,
          readingText: lines.join("\n") + "\n",
          note: "note one\nnote two\nnote three",
        }),
        included: [],
      },
      fake().deps,
    );
    expect(context.card.reading).toBe(
      lines.slice(0, READING_PREVIEW_LINES).join("\n") + "…",
    );
    expect(context.card.note).toBe(
      ["note one", "note two"].slice(0, NOTE_PREVIEW_LINES).join("\n") + "…",
    );
    expect(context.card.name).toBe("rain");
  });

  test("current says nothing; a changed reading says its sentence", async () => {
    const current = await readAskContext(
      { workspacePath: WS, card: cardFacts({ state: "current" }), included: [] },
      fake().deps,
    );
    expect(current.card.state).toBeNull();

    const changed = await readAskContext(
      { workspacePath: WS, card: cardFacts({ state: "missing" }), included: [] },
      fake().deps,
    );
    // STORY 16.13: the state sentence gained what the on-screen words are.
    expect(changed.card.state).toBe(
      "the file is gone; this is the copy kept when it was added",
    );
  });

  test("a card with no reading offers no card retrieval", async () => {
    const context = await readAskContext(
      {
        workspacePath: WS,
        card: cardFacts({ reading: null, readingText: null, note: null }),
        included: [],
      },
      fake().deps,
    );
    expect(context.card.reading).toBeNull();
    expect(context.card.note).toBeNull();
    expect(context.sources).toEqual([]);
    expect(context.retrievable).toEqual([]);
  });
});

describe("the ONE follow-up reads the pull budget and nothing wider", () => {
  test("a sent block's fuller text comes from the pull reader at its budget", async () => {
    const f = fake({
      heads: { [WS + "/notes/in.md"]: "head" },
      pulled: { text: "the fuller text" },
    });
    const context = await readAskContext(
      {
        workspacePath: WS,
        card: cardFacts(),
        included: [{ form: "path", value: "notes/in.md" }],
      },
      f.deps,
    );
    const text = await fetchAskBlock(WS, "path notes/in.md", context, f.deps);
    expect(text).toBe("the fuller text");
    expect(f.pulls).toHaveLength(1);
    expect(f.pulls[0]).toEqual({
      path: WS + "/notes/in.md",
      budget: PULL_BUDGET_BYTES,
    });
  });

  test("a name this view did not carry is null: no read at all", async () => {
    const f = fake({ pulled: { text: "never" } });
    const context = await readAskContext(
      { workspacePath: WS, card: cardFacts(), included: [] },
      f.deps,
    );
    expect(await fetchAskBlock(WS, "some other file", context, f.deps)).toBeNull();
    expect(await fetchAskBlock(WS, "rain", null, f.deps)).toBeNull();
    expect(f.pulls).toEqual([]);
  });

  test("a refused pull is null (the first answer stands)", async () => {
    const f = fake({ pulled: "refused" });
    const context = await readAskContext(
      { workspacePath: WS, card: cardFacts(), included: [] },
      f.deps,
    );
    expect(await fetchAskBlock(WS, "rain", context, f.deps)).toBeNull();
    expect(f.pulls).toHaveLength(1);
  });
});

describe("the preview reader writes nothing", () => {
  test("its bridge surface has no writer at all", () => {
    const code = codeOnly(source("turn/context.ts"));
    for (const forbidden of [
      "writeTextFile",
      "createDirAll",
      "removeFile",
      "readFileBytes",
      "saveReadings",
      "saveNote",
    ]) {
      expect({ forbidden, found: code.includes(forbidden) }).toEqual({
        forbidden,
        found: false,
      });
    }
    // The one pull I/O it can carry is the existing reader's, not its own.
    expect(code).toContain("pullReading");
    expect(code).toContain("PULL_BUDGET_BYTES");
  });

  const workspace = mkdtempSync(join(tmpdir(), "attentioneer-turn-context-"));
  afterAll(() => rmSync(workspace, { recursive: true, force: true }));

  test("a real folder snapshot is byte-identical after previews and a retrieval", async () => {
    mkdirSync(join(workspace, "map", "readings"), { recursive: true });
    writeFileSync(join(workspace, "map", "readings.txt"), "a reading line\n");
    writeFileSync(join(workspace, "map", "readings", "rain.md"), "the stored head\n");
    const snapshot = (): Record<string, string> => {
      const out: Record<string, string> = {};
      const walk = (dir: string, base: string) => {
        for (const name of readdirSync(dir).sort()) {
          const full = join(dir, name);
          const rel = full.slice(base.length + 1);
          const stats = statSync(full);
          if (stats.isDirectory()) {
            out[rel + "/"] = "";
            walk(full, base);
          } else {
            out[rel] = readFileSync(full).toString("base64");
          }
        }
      };
      walk(workspace, workspace);
      return out;
    };
    const before = snapshot();
    const f = fake({ pulled: { text: "pulled" } });
    const context = await readAskContext(
      {
        workspacePath: workspace,
        card: cardFacts({ reading: CARD_READING }),
        included: [],
      },
      f.deps,
    );
    await fetchAskBlock(workspace, "rain", context, f.deps);
    expect(snapshot()).toEqual(before);
  });
});
