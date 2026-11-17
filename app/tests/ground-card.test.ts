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
import {
  deleteConfirmed,
  deleteStepAfter,
  GroundLayer,
} from "../src/canvas/GroundLayer";
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
 *   - the crop is PURE (`previewText`): first six lines, one trailing
 *     ellipsis, and only the FACE is cut — the stored text keeps every line;
 *   - the expanded card shows the STORED reading and nothing else: the layer
 *     has no bridge import and no re-read (asserted by source, because the
 *     card must never gain a fetch);
 *   - the delete runs in ONE fixed order (ground line, readings line, text
 *     file), leaves malformed lines and other references byte-identical, and
 *     a refused unlink answers one sentence without repairing anything;
 *   - the inline confirm is two-step, and any other press backs out.
 *
 * PROVISIONAL (ADR-0003's rendering seam): the card's sizes, the six-line
 * crop, the delete's wording and the open/close behaviour.
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

describe("the small card crops; the stored text is untouched", () => {
  test("the face shows the name, six lines and the file name — not a wall", () => {
    const html = render();
    expect(html).toContain("Rain gauge");
    expect(html).toContain("line 6…");
    expect(html).toContain("gauge.txt");
    // The wall is gone: the seventh line is not on the small face.
    expect(html).not.toContain("line 7");
    // A card, not a stretched row: the surface and the crop are classes.
    expect(html).toContain("ground-reference");
    expect(html).toContain("ground-body");
    expect(html).toContain("ground-footer");
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
    expect(stale).toContain("the file is missing");
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
    // The expanded face is the same stored text, only uncropped.
    expect(code).toContain("previewText(");
    expect(code).toContain("open ? shownText : previewText(shownText)");
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

describe("the confirm is two-step, and any other press backs out", () => {
  test("only the ask's own remove confirms", () => {
    expect(deleteStepAfter("ask")).toBe("asking");
    expect(deleteConfirmed("asking")).toBe(true);
    // A second press that is NOT the confirm (the card, a click away, Esc)
    // cancels: the state goes back to idle and nothing is removed.
    expect(deleteStepAfter("elsewhere")).toBe("idle");
    expect(deleteConfirmed("idle")).toBe(false);
    // Idle -> ask -> elsewhere -> idle: the two-step never chains a delete.
    expect(deleteConfirmed(deleteStepAfter("elsewhere"))).toBe(false);
  });

  test("the words say what goes, inline on the card, with a cancel", () => {
    expect(LAYER).toContain("remove this reference and its reading?");
    expect(LAYER).toContain("deleteStepAfter(\"elsewhere\")");
    expect(LAYER).toContain('e.key !== "Escape"');
    expect(LAYER).toContain('document.addEventListener("mousedown"');
    expect(LAYER).toContain("ground-confirm-remove");
    expect(LAYER).toContain("ground-confirm-cancel");
    // The confirm REPLACES the actions row rather than sitting beside it.
    expect(LAYER).toContain('step === "asking" ? (');
    expect(LAYER).not.toMatch(/window\.confirm|confirm\(/);
  });

  test("the two-step's parts are content to the plane's gate", () => {
    for (const name of [
      "ground-body",
      "ground-footer",
      "ground-remove",
      "ground-confirm",
      "ground-confirm-question",
      "ground-confirm-actions",
      "ground-confirm-remove",
      "ground-confirm-cancel",
      "ground-removal-problem",
    ]) {
      expect(CONTENT_CLASSES).toContain(name as never);
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
      "cancel",
      "remove this reference and its reading?",
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
