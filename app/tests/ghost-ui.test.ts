import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GhostList } from "../src/canvas/GhostList";
import { GhostDiamond } from "../src/canvas/GhostDiamond";
import { GhostPanel } from "../src/canvas/GhostPanel";
import { GhostPreview } from "../src/canvas/GhostPreview";
import {
  CONTENT_CLASSES,
  WORD_CONTROL_CLASSES,
} from "../src/canvas/gates";
import { ASSUMPTIONS_FILE } from "../src/ghost/registry";
import {
  GHOST_FORMAT,
  type GhostEnvelope,
} from "../src/ghost/envelope";
import { ghostRows, type GhostRow } from "../src/ghost/list";
import { beginReshape } from "../src/ghost/reshape";

/**
 * Epic 10 story 3 — the ghost UI, rendered and read.
 *
 * The list is TEXT (no glyph, no field, no plane vocabulary); the preview is
 * mounted ONLY from the person's opening and shows the read-only steps, the why
 * and the two verbs; the reshape's five fields are on the card while it is open
 * and accept is offered only outside it; the diamond is read-only and gated at
 * the gate's lists; the ask surface is the minimal wiring. The source scans hold
 * the wiring's shape (App mounts each surface from exactly one state reading).
 */

const SRC = fileURLToPath(new URL("../src", import.meta.url));
function source(relative: string): string {
  return readFileSync(join(SRC, relative), "utf8");
}

const APP = source("App.tsx");

/** One v1 envelope (the add-assumption move), overridable field by field. */
function envelope(overrides: Partial<GhostEnvelope> = {}): GhostEnvelope {
  return {
    format: GHOST_FORMAT,
    id: "ghost-1",
    move: { family: "assumption", verb: "add" },
    target: { kind: "word", slug: "rain" },
    params: { text: "the claim as proposed" },
    expect: {
      dir: "map",
      files: { [ASSUMPTIONS_FILE]: "a".repeat(64) },
      level: "dynamics",
      game: "dynamics",
    },
    rationale: "the pair is on the map with no claim about it",
    steps: [
      {
        op: "append",
        file: ASSUMPTIONS_FILE,
        line: '{"on":"rain","text":"the claim as proposed"}',
      },
    ],
    proposals: [],
    ...overrides,
  };
}

function noop() {}

function renderList(rows: readonly GhostRow[]): string {
  return renderToStaticMarkup(
    createElement(GhostList, { rows, onOpen: noop }),
  );
}

interface PreviewOverrides {
  envelope?: GhostEnvelope;
  original?: GhostEnvelope | null;
  draft?: ReturnType<typeof beginReshape> | null;
  issues?: readonly string[];
}

function renderPreview(overrides: PreviewOverrides = {}): string {
  const current = overrides.envelope ?? envelope();
  return renderToStaticMarkup(
    createElement(GhostPreview, {
      envelope: current,
      original: overrides.original ?? null,
      nameOf: (slug: string) => slug,
      draft: overrides.draft ?? null,
      issues: overrides.issues ?? [],
      busy: false,
      onBeginReshape: noop,
      onText: noop,
      onReason: noop,
      onCommit: noop,
      onCancel: noop,
      onAccept: noop,
      onReject: noop,
      onClose: noop,
    }),
  );
}

/** The markup's own text (tags stripped, React's entities decoded). */
function textOfMarkup(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

describe("the quiet list is text and nothing else", () => {
  const rows: GhostRow[] = [
    {
      id: "ghost-1",
      summary: 'add an assumption about "rain"',
      rationale: "the pair is on the map with no claim about it",
    },
    {
      id: "ghost-2",
      summary: 'add an assumption about "the water cycle"',
      rationale: "the loop reads as a cycle with nothing said about it",
    },
  ];

  test("the rows are the summary and the why, in arrival order", () => {
    const html = renderList(rows);
    const text = textOfMarkup(html);
    expect(text.indexOf(rows[0].summary)).toBeGreaterThan(-1);
    expect(text.indexOf(rows[1].summary)).toBeGreaterThan(text.indexOf(rows[0].summary));
    expect(text).toContain(rows[0].rationale);
    expect(text).toContain(rows[1].rationale);
  });

  test("no glyph, no field, no tally, no ordering word in the markup", () => {
    const html = renderList(rows);
    // No plane vocabulary: the list can never draw the ghost on the map.
    expect(html).not.toContain("svg");
    expect(html).not.toContain("diamond");
    expect(html).not.toContain("ghost-preview");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("<img");
    // No number the person could read as a tally, and no ordering words.
    expect(textOfMarkup(html)).not.toMatch(/\d/);
    expect(textOfMarkup(html)).not.toMatch(
      /\b(?:count|unread|age|queue|next|badge|backlog|feed|tray|newest|oldest|top|pending|sort)\w*/i,
    );
  });

  test("an empty list renders no row at all (and App never mounts it then)", () => {
    expect(renderList([])).not.toContain("ghost-row");
    expect(APP).toContain("ghosts.rows.length > 0");
  });
});

describe("the preview exists only inside the person's opening", () => {
  test("nothing on the plane while a ghost is merely held (the one reading)", () => {
    // The only plane reading the ghost flow contributes is `previewPoint`, and
    // the app mounts the diamond from it alone.
    expect(APP).toContain("const ghostPoint = useMemo(");
    expect(APP).toContain("previewPoint(ghosts.ghosts, ghosts.openId");
    const diamond = APP.indexOf("<GhostDiamond");
    expect(diamond).toBeGreaterThan(-1);
    expect(APP.slice(Math.max(0, diamond - 320), diamond)).toContain(
      "ghostPoint !== null",
    );
    // One mount, inside the dynamics game (the move's own).
    expect(APP.split("<GhostDiamond").length).toBe(2);
  });

  test("the preview card is mounted from the opened ghost and nothing else", () => {
    const preview = APP.indexOf("<GhostPreview");
    expect(preview).toBeGreaterThan(-1);
    expect(APP.slice(Math.max(0, preview - 320), preview)).toContain(
      "ghosts.opened !== null",
    );
    expect(APP.split("<GhostPreview").length).toBe(2);
    // The list is mounted from the rows; the stack itself is dynamics only.
    expect(APP).toContain("{level === \"dynamics\" && (ghosts.rows.length > 0 || ghosts.opened !== null)");
    // The hook hands the opened ghost from the state reading, never a guess.
    expect(source("ghost/useGhosts.ts")).toContain(
      "previewOf(state.ghosts, state.openId)",
    );
  });

  test("the preview's own words: the why, the derived step and the two verbs", () => {
    const html = renderPreview();
    const text = textOfMarkup(html);
    expect(text).toContain("the pair is on the map with no claim about it");
    expect(text).toContain("append one line to " + ASSUMPTIONS_FILE);
    expect(text).toContain("about rain");
    expect(text).toContain("the claim as proposed");
    expect(text).toContain("accept");
    expect(text).toContain("reject");
    expect(text).toContain("reshape");
    // Read mode is not an editor: the fields exist only while reshaping.
    expect(html).not.toContain("<input");
  });

  test("the card closes by the window's idioms", () => {
    const preview = source("canvas/GhostPreview.tsx");
    // Esc, the ×, a press away (capture phase, so d3 never sees it), and the
    // app's switch path.
    expect(preview).toContain('if (e.key !== "Escape") return;');
    expect(preview).toContain('aria-label="close the proposal"');
    expect(preview).toContain('addEventListener("mousedown", onDown, true)');
    const cancel = APP.slice(
      APP.indexOf("const cancelPendingGestures = useCallback("),
      APP.indexOf("}, [cancelConnect, closePointersQuietly, closePeekQuietly, closeGhosts]);"),
    );
    expect(cancel).toContain("closeGhosts();");
    expect(cancel).toContain("setGhostPanelOpen(false);");
  });

  test("the diamond is the ghost's own mark, faint and taking no press", () => {
    const html = renderToStaticMarkup(
      createElement(GhostDiamond, { at: { x: 10, y: 20 } }),
    );
    expect(html).toContain("ghost-diamond");
    expect(html).toContain("aria-hidden");
    expect(html).toContain("left:10px");
    expect(html).toContain("top:20px");
    // Read-only by construction, and on both gate lists anyway.
    expect(CONTENT_CLASSES).toContain("ghost-diamond");
    expect(WORD_CONTROL_CLASSES).toContain("ghost-diamond");
    const css = source("canvas/canvas.css");
    const rule = css.slice(
      css.indexOf(".ghost-diamond {"),
      css.indexOf("}", css.indexOf(".ghost-diamond {")),
    );
    expect(rule).toContain("pointer-events: none");
  });
});

describe("reshape on the card: the five fields, and accept only outside", () => {
  test("the card shows the original, the new params, the reason, the pin and the ask", () => {
    const original = envelope();
    const draft = beginReshape(original, "0123456789abcdef0123456789abcdef");
    const html = renderPreview({
      envelope: original,
      original,
      draft: {
        ...draft,
        params: { text: "a better claim" },
        reason: "the first wording was vague",
      },
    });
    const text = textOfMarkup(html);
    expect(text).toContain("as proposed: the claim as proposed");
    expect(html).toContain('value="a better claim"');
    expect(html).toContain('value="the first wording was vague"');
    expect(text).toContain("the base: " + ASSUMPTIONS_FILE);
    expect(text).toContain("the ask: 0123456789ab");
    // The steps are re-readable while the reshape is open; the two verbs that
    // end the proposal wait until the reshape is committed or let go.
    expect(text).toContain("append one line to " + ASSUMPTIONS_FILE);
    expect(text).toContain("reshape it");
    expect(text).toContain("let it go");
    expect(text).not.toContain("accept");
    expect(text).not.toContain("reject");
  });

  test("a changed step says so, and its claim stays legible", () => {
    const original = envelope();
    const reshaped = envelope({
      params: { text: "a better claim" },
      steps: [
        {
          op: "append",
          file: ASSUMPTIONS_FILE,
          line: '{"on":"rain","text":"a better claim"}',
        },
      ],
    });
    const html = renderPreview({
      envelope: reshaped,
      original,
      draft: {
        ...beginReshape(original, null),
        params: { text: "a better claim" },
        reason: "why",
      },
    });
    const text = textOfMarkup(html);
    expect(text).toContain("changed");
    expect(text).toContain("a better claim");
    expect(text).toContain("the ask: no ask");
  });

  test("the refusal's sentences are shown, never a code", () => {
    const html = renderPreview({
      issues: ["the file moved since the ghost was built"],
    });
    expect(textOfMarkup(html)).toContain("the file moved since the ghost was built");
  });

  test("the app's accept re-reads the map and the reshaped proposal is the one applied", () => {
    // The accept goes through the session (the only apply) and then reloads the
    // records, so the accepted claim appears and nothing else of the ghost does.
    const accept = APP.slice(
      APP.indexOf("const acceptGhostPreview = useCallback("),
      APP.indexOf("}, [ghosts, reload]);"),
    );
    expect(accept).toContain("ghosts.accept()");
    expect(accept).toContain("void reload();");
    expect(accept).not.toContain("intake");
    // A reshape files the re-derived envelope through the session, never a write
    // from the surface.
    expect(source("ghost/verbs.ts")).toContain("deps.session.reshape(id, params");
    expect(source("canvas/GhostPreview.tsx")).not.toContain("writeText");
  });
});

describe("the ask surface is wired, minimally", () => {
  test("App asks through the quiet request hook and files through the intake", () => {
    expect(APP).toContain("useGhostRequest({");
    expect(APP).toContain("view: () => packetView,");
    expect(APP).toContain("context: () => ({ level, scenario })");
    expect(APP).toContain("void ghostRequest.ask(target);");
    expect(APP).toContain("void ghosts.intake(raw);");
    // The packet's own bytes and hash are shown; nothing is sent anywhere.
    expect(source("canvas/GhostPanel.tsx")).toContain("packet.freeze.bytes");
    expect(source("canvas/GhostPanel.tsx")).toContain("packet.freeze.hash.slice(0, 12)");
  });

  test("the level control's door is the ask, at dynamics only", () => {
    const control = source("canvas/LevelControl.tsx");
    expect(control).toContain("onAsk: () => void;");
    expect(control).toContain(">\n            ask…");
    const dynamics = control.slice(
      control.indexOf('{level === "dynamics" && ('),
      control.indexOf("<ScenarioChooser"),
    );
    expect(dynamics).toContain("onAsk");
    // App opens it through the one cancel-pending path (one live surface).
    expect(APP).toContain("onAsk={openGhostPanel}");
    const open = APP.slice(
      APP.indexOf("const openGhostPanel = useCallback("),
      APP.indexOf("}, [cancelPendingGestures]);"),
    );
    expect(open).toContain("cancelPendingGestures();");
    expect(open).toContain("setGhostPanelOpen(true);");
  });

  test("the panel is deliberately plain: a pick, an ask, the bytes, the paste", () => {
    const html = renderToStaticMarkup(
      createElement(GhostPanel, {
        targets: [
          { key: "word\u0000rain", kind: "word", slug: "rain", label: "rain" },
          {
            key: "loop\u0000the-water-cycle",
            kind: "loop",
            slug: "the-water-cycle",
            label: "the water cycle",
          },
        ],
        packet: null,
        askIssues: [],
        intakeIssues: [],
        onAsk: noop,
        onPropose: noop,
        onClose: noop,
      }),
    );
    const text = textOfMarkup(html);
    expect(text).toContain("pick a word or a loop");
    expect(text).toContain("word: rain");
    expect(text).toContain("loop: the water cycle");
    expect(text).toContain("ask");
    expect(text).toContain("propose");
    expect(html).toContain("<textarea");
  });
});
