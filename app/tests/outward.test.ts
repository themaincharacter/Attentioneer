import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CONTENT_CLASSES,
  CONTENT_SELECTOR,
  isContentElement,
  isWordControl,
  shouldStartWordPress,
  WORD_CONTROL_CLASSES,
  type ClassListLike,
} from "../src/canvas/gates";
import { chooserFocusSelector } from "../src/canvas/pointerRules";
import {
  CANNOT_OPEN,
  CANNOT_OPEN_SCHEME,
  CANNOT_READ,
  CANNOT_REVEAL,
  DEFAULT_URL_SCHEMES,
  PEEK_TOOLTIP,
  PEEK_TRANSIENTS,
  clampPeekAnchor,
  focusAfterPeekClose,
  formatMtime,
  formatSize,
  formatStats,
  joinWorkspacePath,
  peekFocusSelector,
  peekLabel,
  peekTransientsClosedByLevelSwitch,
  resolveTarget,
  schemeAllowed,
  schemeNotice,
  urlScheme,
} from "../src/canvas/outwardRules";

/**
 * The window's outward rules, automated (Epic 5 story 2):
 *
 * - the scheme guard: only opener:default's four URL surfaces may go to
 *   `openUrl`; anything else says "cannot open this scheme" (never a quiet
 *   no-op, never a Rust-side bypass);
 * - resolution is World B: `path` joins the workspace root as written, `at` is
 *   verbatim absolute (its dangle is answered "cannot read", never repaired);
 * - the close/focus rules mirror the chooser's (a dismissal returns focus to the
 *   word's reach handle; a switch to the level button) and a level switch closes
 *   the window;
 * - the tooltip wording is the story's exact sentence;
 * - every new class joins BOTH gate lists;
 * - the geometry is clamped into the viewport, and the identity/size/mtime
 *   words are plain facts (never a badge or a count).
 */

const cl = (...names: string[]): ClassListLike => ({
  contains: (token: string) => names.includes(token),
});

const component = readFileSync(
  new URL("../src/canvas/OutwardWindow.tsx", import.meta.url),
  "utf8",
);
const chooser = readFileSync(
  new URL("../src/canvas/PointerChooser.tsx", import.meta.url),
  "utf8",
);
const outward = readFileSync(
  new URL("../src/canvas/outward.ts", import.meta.url),
  "utf8",
);
const rust = readFileSync(
  new URL("../src-tauri/src/lib.rs", import.meta.url),
  "utf8",
);
const css = readFileSync(
  new URL("../src/canvas/canvas.css", import.meta.url),
  "utf8",
);

/** A CSS rule's body, for the window's quiet-motion and reading-surface rules. */
function ruleBody(selector: string): string {
  const start = css.indexOf(selector + " {");
  if (start === -1) return "";
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return close === -1 ? "" : css.slice(open + 1, close);
}

describe("the scheme guard: four surfaces, one honest sentence", () => {
  test("opener:default's four schemes are allowed, cased and padded", () => {
    expect([...DEFAULT_URL_SCHEMES]).toEqual(["http", "https", "mailto", "tel"]);
    for (const url of [
      "http://example.org",
      "https://example.org/x?y=1",
      "mailto:someone@example.org",
      "tel:+15550100",
      "HTTPS://EXAMPLE.ORG",
      "MailTo:someone@example.org",
    ]) {
      expect(schemeAllowed(url)).toBe(true);
      expect(schemeNotice(url)).toBeNull();
    }
  });

  test("every other scheme is refused before the IPC call", () => {
    for (const url of [
      "obsidian://open?vault=x",
      "zotero://select/items/1",
      "file:///home/k/x.md",
      "javascript:alert(1)",
      "ftp://example.org",
      "not a url",
      "notes/x.md",
      "/home/k/x.md",
      "C:\\Users\\k\\x.md",
      "",
    ]) {
      expect(schemeAllowed(url)).toBe(false);
      expect(schemeNotice(url)).toBe(CANNOT_OPEN_SCHEME);
    }
    expect(CANNOT_OPEN_SCHEME).toBe("cannot open this scheme");
  });

  test("the scheme is read as written, never guessed and never repaired", () => {
    expect(urlScheme("https://x")).toBe("https");
    expect(urlScheme("obsidian://x")).toBe("obsidian");
    expect(urlScheme("HtTp://x")).toBe("http");
    expect(urlScheme("notes/x.md")).toBeNull();
    expect(urlScheme("//example.org/x")).toBeNull();
    expect(urlScheme("1http://x")).toBeNull();
  });
});

describe("resolution: World B, never a sandbox", () => {
  test("a path joins the workspace root as written", () => {
    expect(joinWorkspacePath("/home/k/ws", "notes/x.md")).toBe(
      "/home/k/ws/notes/x.md",
    );
    expect(joinWorkspacePath("/home/k/ws/", "notes/x.md")).toBe(
      "/home/k/ws/notes/x.md",
    );
    // The value is never normalized: a leading slash and '..' keep their
    // filesystem meaning (the app is a convention boundary, not a sandbox).
    expect(joinWorkspacePath("/home/k/ws", "/etc/hosts")).toBe(
      "/home/k/ws//etc/hosts",
    );
    expect(joinWorkspacePath("/home/k/ws", "../elsewhere/x.md")).toBe(
      "/home/k/ws/../elsewhere/x.md",
    );
    // A Windows workspace root joins with its own separator.
    expect(joinWorkspacePath("C:\\Users\\k\\ws", "notes\\x.md")).toBe(
      "C:\\Users\\k\\ws\\notes\\x.md",
    );
  });

  test("the three forms resolve where they were authored to point", () => {
    expect(resolveTarget("path", "notes/x.md", "/ws")).toEqual({
      kind: "file",
      path: "/ws/notes/x.md",
    });
    // 'at' is verbatim absolute and machine-local: no repair, no re-rooting.
    expect(resolveTarget("at", "/etc/hosts", "/ws")).toEqual({
      kind: "file",
      path: "/etc/hosts",
    });
    // A url is verbatim, any scheme (the guard decides what may open).
    expect(resolveTarget("url", "obsidian://x", "/ws")).toEqual({
      kind: "url",
      url: "obsidian://x",
    });
  });

  test("a pointer is a snapshot, not a cached read: resolution is per open", () => {
    // Two different roots resolve the same authored value differently — the
    // function has no hidden workspace state.
    expect(resolveTarget("path", "x.md", "/a").path).toBe("/a/x.md");
    expect(resolveTarget("path", "x.md", "/b").path).toBe("/b/x.md");
  });
});

describe("the tooltip and the quiet words", () => {
  test("the tooltip says exactly the story's sentence", () => {
    expect(PEEK_TOOLTIP).toBe("an open-moment glimpse — reopen to refresh");
    expect(component).toContain("title={PEEK_TOOLTIP}");
    expect(component).toContain("peekLabel(");
  });

  test("failures are plain sentences, never a promised launch", () => {
    expect(CANNOT_READ).toBe("cannot read");
    expect(CANNOT_OPEN).toBe("cannot open");
    expect(CANNOT_REVEAL).toBe("cannot reveal");
    expect(component).toContain("CANNOT_READ");
    expect(component).toContain("outward-reveal");
    expect(component).toContain("reveal");
    expect(component).toContain("outward-open");
  });

  test("the truncation note is honest even when wrapping clips the head", () => {
    // The bridge's `truncated` plus the card's own measured overflow: a long
    // single line (or 80-column code) never hides a tail without saying so.
    expect(component).toContain("scrollHeight");
    expect(component).toContain("clientHeight");
    expect(component).toContain("state.truncated || clipped");
    expect(component).toContain("truncated</div>");
    // No scroll surface, no drag-select on the head.
    expect(component).not.toContain("onScroll");
  });

  test("the window is a world-anchored, counter-scaled, non-draggable card", () => {
    expect(component).toContain("1 / camera.zoom");
    expect(component).toContain("transformOrigin");
    expect(component).toContain("clampPeekAnchor(");
    // No stored spot, no drag handle, no resize grip, no scroll surface.
    expect(component).not.toContain("onDragStart");
    expect(component).not.toContain("draggable=");
    expect(component).not.toContain("resize: both");
    expect(component).not.toContain("onScroll");
    expect(component).not.toContain("overflow: auto");
  });

  test("the window is write-free and reads only through the bridge", () => {
    for (const forbidden of [
      "writeTextFile",
      "write_text_file",
      "saveReference",
      "savePointers",
      "renameFile",
      "removeFile",
    ]) {
      expect(component).not.toContain(forbidden);
      expect(outward).not.toContain(forbidden);
    }
    expect(component).toContain("readTextHead(");
  });

  test("a url is the handle plus the open action, never a glimpse", () => {
    // The url branch comes first and renders no head/stats (no "glimpse" of a
    // remote page: the app hands it to the browser).
    const urlBranchStart = component.indexOf("isUrl ?");
    const textBranch = component.indexOf(
      'state.kind === "text" ?',
      urlBranchStart,
    );
    expect(urlBranchStart).toBeGreaterThan(-1);
    expect(textBranch).toBeGreaterThan(urlBranchStart);
    const urlBranch = component.slice(urlBranchStart, textBranch);
    expect(urlBranch).not.toContain("outward-head");
    expect(urlBranch).not.toContain("outward-stats");
    expect(urlBranch).toContain("outward-open");
  });
});

describe("closing: one at a time, focus home, switch closes", () => {
  test("focus returns to the word's reach handle, or the level button on a switch", () => {
    expect(focusAfterPeekClose("dismiss")).toBe("word");
    expect(focusAfterPeekClose("switch-level")).toBe("level");
    // The same canvas markup contract the chooser's focus return owns.
    expect(peekFocusSelector("word", "rain")).toBe(
      chooserFocusSelector("word", "rain"),
    );
    expect(peekFocusSelector("level")).toBe(chooserFocusSelector("level"));
    expect(peekFocusSelector("word", "rain")).toBe(
      '.word[data-slug="rain"] .reach-handle',
    );
  });

  test("a level switch closes the window", () => {
    expect(peekTransientsClosedByLevelSwitch()).toEqual(["window"]);
    expect(PEEK_TRANSIENTS).toHaveLength(1);
  });

  test("the close paths are Esc, the ×, a press outside and the switch", () => {
    expect(component).toContain('e.key !== "Escape"');
    expect(component).toContain("addEventListener(\"mousedown\", onDown, true)");
    expect(component).toContain("outward-close");
    expect(component).toContain("onClose();");
    // App drops the window on a rename/remove of its word (the mirror).
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    expect(app).toContain("closePeekFor(");
    expect(app).toContain("closePeekQuietly();");
    expect(app).toContain("openPeek(");
    expect(app).toContain("closePeek(\"dismiss\")");
    expect(app).toContain('level === "ground" && peekAt');
  });

  test("the aria label names the word and the form, quietly", () => {
    expect(peekLabel("rain", "url")).toContain("rain");
    expect(peekLabel("rain", "url")).toContain("url");
    expect(peekLabel("rain", "path")).toContain("path");
  });
});

describe("the card's reading surface stays a glimpse (css)", () => {
  test("the handle is selectable; the head is not, and neither scrolls", () => {
    expect(ruleBody(".outward-handle")).toContain("user-select: text");
    const head = ruleBody(".outward-head");
    expect(head).toContain("user-select: none");
    expect(head).toContain("overflow: hidden");
    expect(head).toContain("max-height");
    expect(ruleBody(".outward-window")).toContain("overflow: hidden");
  });

  test("no entrance motion: the card appears, it does not animate in", () => {
    expect(ruleBody(".outward-window")).not.toContain("animation");
    // The global reduced-motion rule still collapses the quiet transitions.
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain(".plane.gesture-armed .outward-window");
  });

  test("the row's open action and the window's two actions are styled", () => {
    expect(css).toContain(".pointer-open");
    expect(css).toContain(".outward-open");
    expect(css).toContain(".outward-reveal");
    expect(css).toContain(".outward-close");
  });
});

describe("the identity line and the clamp", () => {
  test("size and mtime are plain facts, deterministically said", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(999)).toBe("999 B");
    expect(formatSize(1500)).toBe("1.5 kB");
    expect(formatSize(2_500_000)).toBe("2.5 MB");
    expect(formatSize(null)).toBe("");
    const when = Date.UTC(2026, 10, 15, 20, 4);
    expect(formatMtime(when)).toBe("2026-11-15 20:04 UTC");
    expect(formatMtime(null)).toBeNull();
    expect(formatStats(1500, when)).toBe(
      "1.5 kB · modified 2026-11-15 20:04 UTC",
    );
    expect(formatStats(null, null)).toBe("");
  });

  test("a window inside the viewport does not move", () => {
    const placed = clampPeekAnchor(
      { x: 100, y: 100 },
      { x: 0, y: 0, zoom: 1 },
      { width: 800, height: 600 },
      { width: 200, height: 120 },
    );
    expect(placed).toEqual({ x: 100, y: 100 });
  });

  test("a word past the viewport's edge still opens a readable glimpse", () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    const viewport = { width: 800, height: 600 };
    const size = { width: 200, height: 120 };
    const right = clampPeekAnchor({ x: 5000, y: 100 }, camera, viewport, size);
    expect(right.x).toBe(800 - 12 - 200);
    expect(right.y).toBe(100);
    // The anchor is the card's left-center: the vertical half-height is kept in
    // view, so the bottom clamp lands at 600 - 12 - 60.
    const bottom = clampPeekAnchor({ x: 100, y: 5000 }, camera, viewport, size);
    expect(bottom.y).toBe(600 - 12 - 60);
    const topLeft = clampPeekAnchor({ x: -500, y: -500 }, camera, viewport, size);
    expect(topLeft).toEqual({ x: 12, y: 12 + 60 });
  });

  test("the clamp follows the camera's pan and zoom", () => {
    // At zoom 2 the window is half as wide in world space.
    const placed = clampPeekAnchor(
      { x: 5000, y: 0 },
      { x: 0, y: 0, zoom: 2 },
      { width: 800, height: 600 },
      { width: 200, height: 120 },
    );
    expect(placed.x).toBe(400 - 6 - 100);
    // Panning the plane right moves the visible world with it.
    const panned = clampPeekAnchor(
      { x: 5000, y: 0 },
      { x: 300, y: 0, zoom: 1 },
      { width: 800, height: 600 },
      { width: 200, height: 120 },
    );
    expect(panned.x).toBe(800 - 300 - 12 - 200);
    // The vertical clamp follows the zoom too: half of 120 screen pixels is
    // 30 world units at zoom 2, so an anchor at the world's top edge is pushed
    // down to 6 (margin) + 30 (half-height).
    expect(placed.y).toBe(6 + 30);
    const low = clampPeekAnchor(
      { x: 0, y: 5000 },
      { x: 0, y: 0, zoom: 2 },
      { width: 800, height: 600 },
      { width: 200, height: 120 },
    );
    expect(low.y).toBe(300 - 6 - 30);
    // A zero zoom never divides by zero.
    const zero = clampPeekAnchor(
      { x: 5000, y: 0 },
      { x: 0, y: 0, zoom: 0 },
      { width: 800, height: 600 },
      { width: 200, height: 120 },
    );
    expect(Number.isFinite(zero.x)).toBe(true);
    expect(zero.x).toBe(800 - 12 - 200);
  });
});

describe("the window joins both gate lists", () => {
  const WINDOW_ELEMENTS = [
    "pointer-open",
    "outward-window",
    "outward-handle",
    "outward-stats",
    "outward-head",
    "outward-note",
    "outward-open",
    "outward-reveal",
    "outward-close",
  ];

  test("every window element is content (never a plane gesture)", () => {
    for (const name of WINDOW_ELEMENTS) {
      expect(CONTENT_CLASSES).toContain(name as never);
      expect(isContentElement(cl(name))).toBe(true);
      expect(CONTENT_SELECTOR).toContain("." + name);
    }
  });

  test("every window element owns its press, never a word gesture", () => {
    for (const name of WINDOW_ELEMENTS) {
      expect(WORD_CONTROL_CLASSES).toContain(name as never);
      expect(isWordControl(cl(name))).toBe(true);
      expect(shouldStartWordPress("idle", cl(name))).toBe(false);
    }
  });

  test("the gate lists stay duplicate-free and Level 1 stays untouched", () => {
    expect(new Set(CONTENT_CLASSES).size).toBe(CONTENT_CLASSES.length);
    expect(new Set(WORD_CONTROL_CLASSES).size).toBe(WORD_CONTROL_CLASSES.length);
    for (const name of [
      "word",
      "reach-handle",
      "pointer-chooser",
      "assumption-overlay",
      "sign-choice",
      "walk",
    ]) {
      expect(CONTENT_SELECTOR).toContain("." + name);
    }
  });
});

describe("outward goes through the IPC/JS API, never a Rust-side bypass", () => {
  test("the opener is called from the JS plugin, and the Rust side never opens", () => {
    expect(outward).toContain('from "@tauri-apps/plugin-opener"');
    expect(outward).toContain("openPath(");
    expect(outward).toContain("openUrl(");
    expect(outward).toContain("revealItemInDir(");
    // The research's trap: Rust-side opener calls bypass the capability scope.
    expect(rust).not.toContain("open_path");
    expect(rust).not.toContain("opener()");
    // The capability carries the scoped open-path grant (the research's JSON).
    const capability = readFileSync(
      new URL("../src-tauri/capabilities/default.json", import.meta.url),
      "utf8",
    );
    expect(capability).toContain('"opener:allow-open-path"');
    expect(capability).toContain('{ "path": "$HOME/**" }');
    expect(capability).toContain('{ "path": "/mnt/c/**" }');
    expect(capability).toContain('"deny"');
    expect(capability).toContain('{ "path": "$HOME/.ssh/**" }');
    expect(capability).toContain('{ "path": "$HOME/.config/**" }');
    // And it is an IPC plugin call, not a local command.
    expect(outward).not.toContain('invoke("open');
  });

  test("the chooser row's open action is the window's door", () => {
    expect(chooser).toContain("onOpen");
    expect(chooser).toContain("pointer-open");
    expect(chooser).toContain("onOpen(pointer)");
    // Never a webview link: an <a href> would navigate, not reach the OS.
    expect(chooser).not.toContain("<a ");
    expect(chooser).not.toContain("href=");
  });
});
