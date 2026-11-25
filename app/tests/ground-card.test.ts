import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DELETE_IS_IMMEDIATE, GroundLayer } from "../src/canvas/GroundLayer";
import { CONTENT_CLASSES } from "../src/canvas/gates";
import {
  GROUND_REMOVAL_REFUSAL,
  removeGroundRecords,
  type GroundRemovalIo,
} from "../src/canvas/useGround";
import {
  groundPath,
  loadGround,
  saveGround,
  withGroundRemoved,
  type GroundIo,
  type GroundReference,
} from "../src/map/ground";
import {
  previewText,
  readingTextPath,
  readingsPath,
  saveReadings,
  withReadingRemoved,
  READING_PREVIEW_LINES,
  type Reading,
} from "../src/map/readings";

/**
 * Story 16.3 — the reference is a CARD, and it can be REMOVED.
 *
 * The story's check is human ("a long text file shows as a card: name, a few
 * lines, the file name; click it: it opens into a larger card whose body
 * scrolls the lines that were taken; click away: it closes; then delete it in
 * two steps and a reopened workspace does not bring it back"). This file pins
 * the rules underneath it:
 *
 *   - the reading renders WHOLE and pages at the person's stated count
 *     (`PagedText`; the pure crop helper survives for the note alone) — the
 *     stored text keeps every line;
 *   - the expanded card shows the STORED reading and nothing else: the layer
 *     has no bridge import and no re-read (asserted by source, because the
 *     card must never gain a fetch);
 *   - the delete runs in ONE fixed order (ground line, readings line, text
 *     file), leaves malformed lines and other references byte-identical, and
 *     a refused unlink answers one sentence without repairing anything;
 *   - the delete is IMMEDIATE (story 16.13 removed the two-step confirm);
 *     the toast's Restore is the guard, pinned in ground-restore.test.ts.
 *
 * PROVISIONAL (ADR-0003's rendering seam): the card's sizes, the page
 * size, the delete's wording and the open/close behaviour.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}
const LAYER = source("canvas/GroundLayer.tsx");
const CSS = source("canvas/canvas.css");

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-card-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map"), { recursive: true });
  return path;
}

const groundIo: GroundIo = {
  readTextFile: async (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  writeTextFile: async (path, content) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  },
};

/** The delete's bridges, logging the ORDER and the one unlink attempt. */
function removalIo(log: string[], refuseUnlink = false): GroundRemovalIo {
  return {
    saveGround: async (workspace, references, malformed) => {
      log.push("ground");
      await saveGround(workspace, references, malformed ?? [], groundIo);
    },
    saveReadings: async (workspace, readings, malformed) => {
      log.push("readings");
      await saveReadings(workspace, readings, malformed ?? [], groundIo);
    },
    removeFile: async (path) => {
      log.push("unlink");
      if (refuseUnlink) throw new Error("EPERM");
      try {
        rmSync(path);
      } catch (error) {
        if ((error as { code?: string }).code !== "ENOENT") throw error;
      }
    },
  };
}

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
  bytes: 260,
};

/** Ten lines: more than a card's face, so the preview must crop. */
const LONG = Array.from({ length: 10 }, (_, index) => "line " + (index + 1)).join(
  "\n",
);

const inertVerbs = {
  onMove: async () => ({ ok: true as const }),
  onRefresh: async () => ({ ok: true as const }),
  onRepoint: async () => ({ ok: true as const }),
  onRemove: async () => ({ ok: true as const }),
};

function render(texts: Record<string, string> = { "rain-gauge": LONG }) {
  return renderToStaticMarkup(
    createElement(GroundLayer, {
      references: [reference],
      readings: [reading],
      texts,
      states: { "rain-gauge": "current" },
      ...inertVerbs,
    }),
  );
}

describe("the crop is pure: first six lines, one trailing ellipsis", () => {
  test("empty text previews as nothing", () => {
    expect(previewText("")).toBe("");
    expect(READING_PREVIEW_LINES).toBe(6);
  });

  test("six lines or fewer are unchanged; a trailing newline is no line", () => {
    const six = "one\ntwo\nthree\nfour\nfive\nsix";
    expect(previewText(six)).toBe(six);
    expect(previewText(six + "\n")).toBe(six);
    expect(previewText("one line\n")).toBe("one line");
  });

  test("seven lines crop to six and close with ONE ellipsis", () => {
    const seven = "one\ntwo\nthree\nfour\nfive\nsix\nseven";
    expect(previewText(seven)).toBe("one\ntwo\nthree\nfour\nfive\nsix…");
    // A single trailing ellipsis: no second mark, no per-line truncation.
    expect(previewText(seven).match(/…/g)).toHaveLength(1);
    expect(previewText(LONG)).toBe(
      "line 1\nline 2\nline 3\nline 4\nline 5\nline 6…",
    );
  });

  test("a very long line is kept whole: only the DOM crops it", () => {
    const long = "x".repeat(2000);
    expect(previewText(long)).toBe(long);
    expect(previewText("a\n" + long)).toBe("a\n" + long);
  });

  test("a zero-line crop is empty, never an ellipsis", () => {
    expect(previewText("a\nb", 0)).toBe("");
    expect(previewText("a\nb", 1)).toBe("a…");
  });
});

describe("the small card pages; the stored text is untouched", () => {
  test("the face shows the name, the paged reading and the file name — not a wall", () => {
    const html = render();
    expect(html).toContain("Rain gauge");
    // The reading renders WHOLE — even the tenth line the crop used to cut.
    expect(html).toContain("line 10");
    expect(html).not.toContain("line 6…");
    expect(html).toContain("gauge.txt");
    // A card, not a stretched row and not a wall: the surface classes stay,
    // and the reading flows into PAGES at the person's stated count.
    expect(html).toContain("ground-reference");
    expect(html).toContain("ground-body");
    expect(html).toContain("ground-footer");
    expect(html).toContain('class="paged-flow"');
    expect(html).toContain("--page-lines:4");
  });

  test("every card mounts SMALL: open/closed is view state, never a record", () => {
    expect(render()).not.toContain("expanded");
    // No persistence of the open flag anywhere (a reopened workspace is small).
    expect(LAYER).not.toContain("localStorage");
    expect(LAYER).not.toContain("sessionStorage");
    expect(LAYER).not.toContain("saveGround");
    expect(LAYER).not.toContain("saveReadings");
  });

  test("a current reading adds no state word; a stale one names itself", () => {
    const html = render();
    expect(html).not.toContain("ground-state");
    const stale = renderToStaticMarkup(
      createElement(GroundLayer, {
        references: [reference],
        readings: [reading],
        texts: { "rain-gauge": LONG },
        states: { "rain-gauge": "missing" },
        ...inertVerbs,
      }),
    );
    // STORY 16.13 (shortlist item 10): missing now names the kept copy too.
    expect(stale).toContain(
      "the file is gone; this is the copy kept when it was added",
    );
  });
});

describe("the expanded body shows the STORED reading and nothing else", () => {
  test("the layer has no bridge, no re-read and no fetch", () => {
    const code = LAYER.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /^\s*\/\/.*$/gm,
      "",
    );
    for (const io of [
      "readTextFile",
      "readTextHead",
      "fileMeta",
      "invoke",
      "fetch",
      "readFileSync",
    ]) {
      expect({ io, found: code.includes(io) }).toEqual({ io, found: false });
    }
    // The face is the STORED text, whole — the layer crops nothing itself
    // any more (story 25-2: the pages are the crop; the pure helper stays
    // for the note's marginalia alone).
    expect(code).not.toContain("previewText(");
    expect(code).toContain("const bodyText = shownText;");
    // STORY 17 -> 25-2: the PAGE SIZE is the person's STATED count.
    // STORY 25-4: the page size is the primitive's own default — the person's
    // ruling of four lines (the setting will carry 3/4/5) — and the cue is
    // anchored to the card so it is reachable without expanding.
    expect(code).toContain('anchor="card"');
    expect(code).not.toContain("linesPerPage={previewLines}");
  });

  test("the wheel on the body is kept off the plane's zoom", () => {
    expect(LAYER).toContain('addEventListener("wheel"');
    expect(LAYER).toContain("stopPropagation()");
    expect(CSS).toContain(".ground-reference.expanded .ground-body");
    expect(CSS).toContain("overflow-y: auto");
  });

  test("the card is fixed, not content-sized, in both faces", () => {
    expect(CSS).toMatch(/\.ground-reference \{[^}]*width: 300px/);
    expect(CSS).toMatch(/\.ground-reference \{[^}]*height: 220px/);
    expect(CSS).toMatch(/\.ground-reference\.expanded \{[^}]*width: 520px/);
    expect(CSS).toMatch(/\.ground-reference\.expanded \{[^}]*height: 420px/);
    // The old wall-of-text max-width is gone from the card's own rule.
    expect(CSS).not.toMatch(
      /\.ground-reference \{[^}]*max-width: 340px/,
    );
  });
});

describe("the delete: one fixed order, malformed lines byte-identical", () => {
  const other: GroundReference = { on: "sea", name: "Sea", x: 10, y: 20 };
  const MALFORMED_GROUND = "this ground line is not a reference";
  const MALFORMED_READINGS = "a broken readings line";

  async function seeded(refuseUnlink = false, withText = true) {
    const workspace = freshWorkspace();
    await saveGround(
      workspace,
      [reference, other],
      [MALFORMED_GROUND],
      groundIo,
    );
    await saveReadings(
      workspace,
      [reading, { ...reading, on: "sea", from: "notes/sea.txt" }],
      [MALFORMED_READINGS],
      groundIo,
    );
    if (withText) {
      mkdirSync(dirname(readingTextPath(workspace, "rain-gauge")), {
        recursive: true,
      });
      writeFileSync(
        readingTextPath(workspace, "rain-gauge"),
        LONG + "\n",
        "utf8",
      );
    }
    const log: string[] = [];
    return { workspace, log, io: removalIo(log, refuseUnlink) };
  }

  test("all three pieces go: reference line, reading line, then the text", async () => {
    const { workspace, log, io } = await seeded();
    const before = {
      ground: readFileSync(groundPath(workspace), "utf8"),
      readings: readFileSync(readingsPath(workspace), "utf8"),
    };
    const removal = await removeGroundRecords(
      workspace,
      "rain-gauge",
      await loadReferences(workspace),
      [{ ...reading, on: "sea", from: "notes/sea.txt" }, reading],
      [MALFORMED_GROUND],
      [MALFORMED_READINGS],
      io,
    );
    expect(removal.refusal).toBeNull();
    // THE ORDER (story 16.3): the reference first, then its reading, then text.
    expect(log).toEqual(["ground", "readings", "unlink"]);
    expect(removal.references.map((r) => r.on)).toEqual(["sea"]);
    expect(removal.readings.map((r) => r.on)).toEqual(["sea"]);
    expect(existsSync(readingTextPath(workspace, "rain-gauge"))).toBe(false);

    // The other reference and both malformed lines are byte-identical.
    expect(readFileSync(groundPath(workspace), "utf8")).toBe(
      "on: sea | name: Sea | x: 10 | y: 20\n" + MALFORMED_GROUND + "\n",
    );
    expect(readFileSync(readingsPath(workspace), "utf8")).toBe(
      "on: sea | form: path | from: notes/sea.txt | taken: " +
        reading.taken +
        " | bytes: " +
        reading.bytes +
        "\n" +
        MALFORMED_READINGS +
        "\n",
    );
    // The removed reference's line is gone from a fresh read, not hidden.
    const reloaded = await loadGround(workspace, groundIo);
    expect(reloaded.references.map((r) => r.on)).toEqual(["sea"]);
    expect(reloaded.malformed).toEqual([MALFORMED_GROUND]);
    expect(before.ground).toContain("rain-gauge");
  });

  test("a missing text file still clears both lines (the bridge's no-op)", async () => {
    const { workspace, log, io } = await seeded(false, false);
    const removal = await removeGroundRecords(
      workspace,
      "rain-gauge",
      [reference, other],
      [reading],
      [],
      [],
      io,
    );
    expect(removal.refusal).toBeNull();
    expect(log).toEqual(["ground", "readings", "unlink"]);
    expect(readFileSync(groundPath(workspace), "utf8")).toBe(
      "on: sea | name: Sea | x: 10 | y: 20\n",
    );
    // A file with no lines left is the record files' canonical empty: one LF.
    expect(readFileSync(readingsPath(workspace), "utf8")).toBe("\n");
  });

  test("a refused unlink is ONE sentence, with no repair and no retry", async () => {
    const { workspace, log, io } = await seeded(true);
    const removal = await removeGroundRecords(
      workspace,
      "rain-gauge",
      [reference, other],
      [reading],
      [],
      [],
      io,
    );
    expect(removal.refusal).toBe(GROUND_REMOVAL_REFUSAL);
    expect(removal.refusal).not.toMatch(/\b(error|failed|EPERM)\b/);
    expect(log).toEqual(["ground", "readings", "unlink"]);
    // The lines went (the fixed order); the text file is left as it is.
    expect(readFileSync(groundPath(workspace), "utf8")).toBe(
      "on: sea | name: Sea | x: 10 | y: 20\n",
    );
    expect(readFileSync(readingTextPath(workspace, "rain-gauge"), "utf8")).toBe(
      LONG + "\n",
    );
  });

  test("the pure removers keep order and never mutate their input", () => {
    const references = [reference, other];
    const readings = [reading, { ...reading, on: "sea" }];
    expect(withGroundRemoved(references, "rain-gauge")).toEqual([other]);
    expect(withReadingRemoved(readings, "rain-gauge")).toEqual([
      { ...reading, on: "sea" },
    ]);
    expect(references).toHaveLength(2);
    expect(readings).toHaveLength(2);
  });

  test("the hook's remove is the one write path, through the queue", () => {
    const hook = source("canvas/useGround.ts");
    expect(hook).toContain("removeGroundRecords(");
    expect(hook).toContain("queueRef.current");
    expect(hook).toContain("withGroundRemoved");
    // No second, parallel write path for a delete.
    expect(hook.split("removeGroundRecords(").length - 1).toBe(2);
  });
});

describe("the delete is immediate; the toast is the only guard", () => {
  test("one press removes: there is no asking step left", () => {
    // STORY 16.13 (shortlist item 1): the two-step confirm is REMOVED, and the
    // guard moved to the toast's Restore (ground-restore.test.ts). The delete
    // press calls the one write path without a confirming state.
    expect(DELETE_IS_IMMEDIATE).toBe(true);
    expect(LAYER).not.toContain("remove this reference and its reading?");
    expect(LAYER).not.toContain("ground-confirm");
    expect(LAYER).not.toContain('step === "asking"');
    expect(LAYER).not.toMatch(/window\.confirm|confirm\(/);
    // The press still reaches the one write path, and the card still owns its
    // own refusal sentence while the card is there.
    expect(LAYER).toContain("void removeCard()");
    expect(LAYER).toContain("await onRemove(reference)");
    expect(LAYER).toContain('e.key !== "Escape"');
    expect(LAYER).toContain('document.addEventListener("mousedown"');
  });

  test("the card's parts are content to the plane's gate, the confirm's are gone", () => {
    for (const name of [
      "ground-body",
      "ground-footer",
      "ground-remove",
      "ground-removal-problem",
    ]) {
      expect(CONTENT_CLASSES).toContain(name as never);
    }
    for (const gone of [
      "ground-confirm",
      "ground-confirm-question",
      "ground-confirm-actions",
      "ground-confirm-remove",
      "ground-confirm-cancel",
    ]) {
      expect(CONTENT_CLASSES).not.toContain(gone as never);
    }
  });
});

/** The seeded workspace's references, read back (the delete takes records). */
async function loadReferences(workspace: string): Promise<GroundReference[]> {
  return (await loadGround(workspace, groundIo)).references;
}

describe("the negative space: nothing counts, scores or nudges", () => {
  const FORBIDDEN =
    /\b(badge|count|counts|score|scores|streak|streaks|heat|progress|tally|meter|nudge|remind|backlog|total|points)\b/i;

  test("the new card strings say nothing and count nothing", () => {
    const seen = [
      "remove",
      "point at a file…",
      GROUND_REMOVAL_REFUSAL,
    ];
    for (const text of seen) {
      expect({ text, found: text.match(FORBIDDEN)?.[0] ?? null }).toEqual({
        text,
        found: null,
      });
      expect(text).not.toMatch(/\d/);
    }
  });

  test("the card's own source, comments stripped, stays quiet", () => {
    const code = LAYER.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /^\s*\/\/.*$/gm,
      "",
    );
    expect(code).not.toMatch(FORBIDDEN);
  });
});
