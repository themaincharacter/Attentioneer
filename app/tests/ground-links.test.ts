import { afterAll, describe, expect, test } from "bun:test";
import {
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
import { CONTENT_CLASSES } from "../src/canvas/gates";
import {
  GroundWires,
  cardCenter,
  linkConfirmed,
  linkStepAfter,
  wireGeometry,
} from "../src/canvas/GroundWires";
import { removeGroundLinksNaming } from "../src/canvas/useGround";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import {
  addGroundLink,
  groundLinkRefusal,
  groundLinksPath,
  linkKey,
  loadGroundLinks,
  orphanGroundLinks,
  parseGroundLinks,
  saveGroundLinks,
  serializeGroundLinks,
  withoutGroundLink,
  withoutGroundLinksFor,
  GROUND_LINK_UNKNOWN_REFUSAL,
  GROUND_SELF_LINK_REFUSAL,
  type GroundLink,
} from "../src/map/groundLinks";
import type { GroundReference } from "../src/map/ground";

/**
 * Story 16.5 — two ground cards can be WIRED with a wordless link.
 *
 * The story's check is human ("drop two references and wire one to the other;
 * quit, reopen: the wire is still there; wire the same pair again: still one
 * wire; hover and remove it: the cards stay; wire two cards and delete one: the
 * wire goes with it"). This file pins the rules underneath it:
 *
 *   - the record: one line per ORDERED pair, no word field, identity (from,to),
 *     one line after two draws, the reverse drag a separate line;
 *   - malformed lines survive every write BYTE-IDENTICALLY and are reported;
 *     a line naming an unknown slug is an ORPHAN — kept, never repaired, named
 *     in the ground notices group, never drawn;
 *   - the delete cascade removes a reference's links in BOTH directions in the
 *     same pass, after the reference's own removal;
 *   - the wire's geometry is pure: its midpoint sits between the two cards;
 *   - nothing counts, scores or nudges, and a link carries no meaning.
 *
 * PROVISIONAL (ADR-0003's rendering seam): the line shape, the card box used
 * for anchors, the mark's look and the two-step wording.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-links-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map"), { recursive: true });
  return path;
}

/** The record's bridges, bound to node's fs so a test needs no Tauri. */
const linkIo = {
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

const MALFORMED = "from: rain-gauge | to: | note: hand edit";
const link = (from: string, to: string): GroundLink => ({ from, to });

describe("the record: one line per ordered pair, and no word", () => {
  test("a link is the pair, and the pair is ORDERED", () => {
    const text = serializeGroundLinks([link("a", "b"), link("b", "a")]);
    expect(text).toBe("from: a | to: b\nfrom: b | to: a\n");
    expect(parseGroundLinks(text).links).toEqual([link("a", "b"), link("b", "a")]);
    // The two directions are two identities, never one canonical pair.
    expect(linkKey("a", "b")).not.toBe(linkKey("b", "a"));
  });

  test("drawing the same pair twice leaves ONE line, in its original place", () => {
    const once = addGroundLink([link("a", "b")], "a", "b");
    expect(once).toEqual([link("a", "b")]);
    const twice = addGroundLink(once, "a", "b");
    expect(twice).toEqual([link("a", "b")]);
    // The reverse drag is a second, separate line.
    expect(addGroundLink(twice, "b", "a")).toEqual([
      link("a", "b"),
      link("b", "a"),
    ]);
    // A re-draw keeps file order: it rewrites in place, never appends.
    expect(addGroundLink([link("x", "y"), link("a", "b")], "a", "b")).toEqual([
      link("x", "y"),
      link("a", "b"),
    ]);
  });

  test("there is no word, no sign and no meaning in the record", () => {
    const record = source("map/groundLinks.ts");
    // No label field: the shape is two slugs and nothing else.
    expect(record).not.toMatch(/word\s*:/);
    expect(record).not.toMatch(/label\s*:/);
    // The direction is explicitly unread: nothing here exports a flow.
    expect(record).not.toContain("context packet");
  });

  test("parsing tolerates CRLF/BOM and keeps an unreadable line verbatim", () => {
    const text = "\uFEFFfrom: a | to: b\r\n" + MALFORMED + "\r\n";
    const parsed = parseGroundLinks(text);
    expect(parsed.links).toEqual([link("a", "b")]);
    expect(parsed.malformed).toEqual([MALFORMED]);
    // The malformed line is re-emitted byte-identically on every write.
    expect(serializeGroundLinks(parsed.links, parsed.malformed)).toBe(
      "from: a | to: b\n" + MALFORMED + "\n",
    );
    // A line missing an endpoint, or carrying an extra field, is unreadable.
    expect(parseGroundLinks("from: a | to:").malformed).toHaveLength(1);
    expect(parseGroundLinks("from: a | to: b | word: x").malformed).toHaveLength(1);
  });

  test("a malformed line survives a disk round trip byte-identically", async () => {
    const workspace = freshWorkspace();
    await saveGroundLinks(workspace, [link("a", "b")], [MALFORMED], linkIo);
    const before = readFileSync(groundLinksPath(workspace), "utf8");
    expect(before).toBe("from: a | to: b\n" + MALFORMED + "\n");
    const parsed = await loadGroundLinks(workspace, linkIo);
    await saveGroundLinks(workspace, parsed.links, parsed.malformed, linkIo);
    expect(readFileSync(groundLinksPath(workspace), "utf8")).toBe(before);
    // Saving an unchanged pair again cannot disturb the kept line either.
    await saveGroundLinks(
      workspace,
      addGroundLink(parsed.links, "a", "b"),
      parsed.malformed,
      linkIo,
    );
    expect(readFileSync(groundLinksPath(workspace), "utf8")).toBe(before);
  });

  test("a missing file means no links; the map folder alone rebuilds them", async () => {
    const workspace = freshWorkspace();
    expect(await loadGroundLinks(workspace, linkIo)).toEqual({
      links: [],
      malformed: [],
    });
    await saveGroundLinks(workspace, [link("a", "b")], [], linkIo);
    expect(readFileSync(groundLinksPath(workspace), "utf8")).toBe(
      "from: a | to: b\n",
    );
  });
});

describe("the pure rules: remove, orphans, refusals", () => {
  test("unlink removes ONE exact pair; the reverse line stays", () => {
    const links = [link("a", "b"), link("b", "a"), link("a", "c")];
    expect(withoutGroundLink(links, "a", "b")).toEqual([
      link("b", "a"),
      link("a", "c"),
    ]);
    // Removing the reverse pair only takes that direction.
    expect(withoutGroundLink(links, "b", "a")).toEqual([
      link("a", "b"),
      link("a", "c"),
    ]);
    expect(links).toHaveLength(3);
  });

  test("the cascade removes BOTH directions of everything that names a slug", () => {
    const links = [
      link("a", "b"),
      link("b", "a"),
      link("b", "c"),
      link("c", "d"),
      link("a", "c"),
    ];
    expect(withoutGroundLinksFor(links, "b")).toEqual([
      link("c", "d"),
      link("a", "c"),
    ]);
    expect(links).toHaveLength(5);
  });

  test("an orphan names a slug the map does not carry, and is kept", () => {
    const links = [link("a", "b"), link("a", "gone"), link("lost", "b")];
    expect(orphanGroundLinks(links, ["a", "b"])).toEqual([
      link("a", "gone"),
      link("lost", "b"),
    ]);
    expect(orphanGroundLinks(links, ["a", "b", "gone", "lost"])).toEqual([]);
    // Orphans are NOT deleted: the remover only takes what it names.
    expect(withoutGroundLinksFor(links, "a")).toEqual([link("lost", "b")]);
  });

  test("a self-link refuses with one sentence; so does an unknown card", () => {
    expect(groundLinkRefusal("a", "a", ["a", "b"])).toBe(GROUND_SELF_LINK_REFUSAL);
    expect(groundLinkRefusal("a", "a", ["a", "b"])).toMatch(/itself/);
    expect(groundLinkRefusal("a", "gone", ["a", "b"])).toBe(
      GROUND_LINK_UNKNOWN_REFUSAL,
    );
    expect(groundLinkRefusal("a", "b", ["a", "b"])).toBeNull();
    // The sentence is ONE sentence, never an error dump.
    expect(GROUND_SELF_LINK_REFUSAL).not.toMatch(/\b(error|failed)\b/);
  });
});

describe("the cascade writes in the same pass, after the reference's own removal", () => {
  test("both directions go; other lines and malformed lines are byte-identical", async () => {
    const workspace = freshWorkspace();
    const links = [
      link("rain-gauge", "sea"),
      link("sea", "rain-gauge"),
      link("sea", "wind"),
      link("wind", "sea"),
    ];
    await saveGroundLinks(workspace, links, [MALFORMED], linkIo);
    const next = await removeGroundLinksNaming(
      workspace,
      "rain-gauge",
      links,
      [MALFORMED],
      linkIo,
    );
    expect(next).toEqual([link("sea", "wind"), link("wind", "sea")]);
    expect(readFileSync(groundLinksPath(workspace), "utf8")).toBe(
      "from: sea | to: wind\nfrom: wind | to: sea\n" + MALFORMED + "\n",
    );
    // The kept line reloads exactly as it was written.
    const reloaded = await loadGroundLinks(workspace, linkIo);
    expect(reloaded.malformed).toEqual([MALFORMED]);
  });

  test("the hook cascades AFTER the card's own removal, through its one queue", () => {
    const hook = source("canvas/useGround.ts");
    const remove = hook.slice(hook.indexOf("const remove = useCallback"));
    expect(remove).toContain("removeGroundRecords(");
    const groundAt = remove.indexOf("removeGroundRecords(");
    // STORY 17.9 keeps a context wire dangling, so the cascade filters the list
    // and writes it through the same one link writer rather than the old helper.
    const linksAt = remove.indexOf("saveGroundLinks(");
    expect(groundAt).toBeGreaterThan(-1);
    expect(linksAt).toBeGreaterThan(groundAt);
    // The cascade is inside the same queued write, not a second path.
    expect(remove).toContain("queueRef.current");
  });
});

describe("the wire: pure geometry, a midpoint between the two cards", () => {
  const A: GroundReference = { on: "a", name: "A", x: 0, y: 0 };
  const B: GroundReference = { on: "b", name: "B", x: 600, y: 0 };

  test("two cards side by side: facing edges, a straight line and its midpoint", () => {
    const geometry = wireGeometry(A, B);
    expect(geometry).not.toBeNull();
    expect(geometry!.from).toEqual({ x: 300, y: 110 });
    expect(geometry!.to).toEqual({ x: 600, y: 110 });
    expect(geometry!.mid).toEqual({ x: 450, y: 110 });
    expect(geometry!.length).toBe(300);
    expect(geometry!.angle).toBe(0);
  });

  test("the midpoint sits BETWEEN the two cards, and on the wire", () => {
    const diagonal: GroundReference = { on: "c", name: "C", x: 500, y: 500 };
    const geometry = wireGeometry(A, diagonal)!;
    const ac = cardCenter(A);
    const cc = cardCenter(diagonal);
    expect(geometry.mid.x).toBeGreaterThan(Math.min(ac.x, cc.x));
    expect(geometry.mid.x).toBeLessThan(Math.max(ac.x, cc.x));
    expect(geometry.mid.y).toBeGreaterThan(Math.min(ac.y, cc.y));
    expect(geometry.mid.y).toBeLessThan(Math.max(ac.y, cc.y));
    expect(geometry.mid.x).toBe((geometry.from.x + geometry.to.x) / 2);
    expect(geometry.mid.y).toBe((geometry.from.y + geometry.to.y) / 2);
  });

  test("cards stacked vertically anchor on the top and bottom edges", () => {
    const below: GroundReference = { on: "d", name: "D", x: 0, y: 400 };
    const geometry = wireGeometry(A, below)!;
    expect(geometry.from).toEqual({ x: 150, y: 220 });
    expect(geometry.to).toEqual({ x: 150, y: 400 });
  });

  test("cards on the SAME point draw nothing (the record still exists)", () => {
    const same: GroundReference = { on: "e", name: "E", x: 0, y: 0 };
    expect(wireGeometry(A, same)).toBeNull();
  });
});

describe("the layer: the wire is the only ink", () => {
  const A: GroundReference = { on: "a", name: "A", x: 0, y: 0 };
  const B: GroundReference = { on: "b", name: "B", x: 600, y: 0 };
  const inert = async () => ({ ok: true as const });

  test("a link renders one quiet wire with no label and no arrowhead", () => {
    const html = renderToStaticMarkup(
      createElement(GroundWires, {
        links: [link("a", "b")],
        references: [A, B],
        onRemoveLink: inert,
      }),
    );
    expect(html).toContain('data-from="a"');
    expect(html).toContain('data-to="b"');
    expect(html).toContain("ground-wire-line");
    expect(html).toContain("ground-wire-mark");
    // WORDLESS: no label, no arrow, no count.
    expect(html).not.toContain("ground-wire-label");
    expect(html).not.toContain("marker-end");
    // Nothing in the layer says how many links there are.
    expect(html).not.toMatch(/\b\d+ link/);
  });

  test("an orphan is NOT drawn (it has no card), and still reloads", () => {
    const html = renderToStaticMarkup(
      createElement(GroundWires, {
        links: [link("a", "gone")],
        references: [A, B],
        onRemoveLink: inert,
      }),
    );
    expect(html).not.toContain("data-from");
    expect(html).not.toContain("ground-wire-line");
  });

  test("the wire's remove is two-step, exactly like the card's delete", () => {
    expect(linkStepAfter("ask")).toBe("asking");
    expect(linkConfirmed("asking")).toBe(true);
    expect(linkStepAfter("elsewhere")).toBe("idle");
    expect(linkConfirmed("idle")).toBe(false);
    const component = source("canvas/GroundWires.tsx");
    expect(component).toContain("remove this link?");
    expect(component).toContain('event.key === "Escape"');
  });

  test("the link handle is a NEW affordance, not a new meaning for the card", () => {
    const layer = source("canvas/GroundLayer.tsx");
    expect(layer).toContain("ground-link-handle");
    // The card's own press rules survive: the 4px threshold and the button skip.
    expect(layer).toContain("moveGroundDrag");
    expect(layer).toContain('closest("button")');
    // The handle is handled BEFORE the generic button skip (it is a button).
    expect(layer.indexOf("ground-link-handle")).toBeLessThan(
      layer.indexOf('closest("button")'),
    );
    for (const name of [
      "ground-link-handle",
      "ground-wires",
      "ground-wire",
      "ground-wire-line",
      "ground-wire-hit",
      "ground-wire-mark",
      "ground-wire-confirm",
      "ground-wire-confirm-remove",
    ]) {
      expect(CONTENT_CLASSES).toContain(name);
    }
  });

  test("the wire's world-space transform scales with the plane", () => {
    const css = source("canvas/canvas.css");
    const block = css.slice(css.indexOf(".ground-wires"));
    expect(block).toContain(".ground-wire-line");
    expect(block).toContain("transform-origin: 0 0");
    // Scale is the plane's, not the layer's: no counter-scaled screen overlay.
    expect(block.slice(0, block.indexOf(".ground-link-handle"))).not.toContain(
      "vector-effect",
    );
  });

  test("the ground map still renders no concept family, and no counters", () => {
    expect(renderedMapContent("ground")).toEqual([]);
    const app = source("App.tsx");
    // The wires mount on the ground map only, beside its own layer.
    const groundBlock = app.slice(app.indexOf("GroundWires"));
    expect(groundBlock).toContain('level === "ground"');
    expect(app).toContain("onRemoveLink={ground.unlink}");
    expect(app).toContain("onLink={ground.link}");
  });
});
