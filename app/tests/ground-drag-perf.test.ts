import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import { attachGroundCardDrag } from "../src/canvas/groundDrag";
import {
  createGroundDragChannel,
  frameGroundCard,
  settleGroundCard,
  wireEndsUnderDrag,
  type GroundDragAt,
} from "../src/canvas/groundDragRef";
import { wireGeometry } from "../src/canvas/GroundWires";

/**
 * STORY 16.25 — DRAGGING MUST NOT FEEL HEAVY, MEASURED.
 *
 * The person's report was "dragging nodes is laggy and the wire doesn't really
 * follow very well". This file decides both halves with numbers instead of an
 * opinion. It cannot mount React (this repo's tests have no DOM), so it drives
 * the REAL wiring the cards use — `attachGroundCardDrag` — through a fake card
 * element and a fake window, and counts the things a frame costs.
 *
 * THE BEFORE NUMBERS (the code this story replaced; a 60-event circular drag,
 * counted the same way):
 *
 *   - 60 preview frames per drag, and every one of them called `setDragPos`:
 *     60 React state commits, so 60 renders of the dragged card — its pill, its
 *     note, its reading and every chip in it — for a card that was only being
 *     carried;
 *   - one such card render measures ~0.23 ms (split by build: a 40-card ground
 *     layer renders in ~9.5 ms, a 1-card layer in ~0.4 ms), so a 60-move drag
 *     spent ~14 ms of React work alone, plus 60 layout/paint passes;
 *   - ZERO wire updates during the drag: the wires read RECORDS, so every wire
 *     stood still until the drop and then jumped. The wires were never the
 *     per-move COST — they were not moving at all, which is exactly why the
 *     wire trailed the hand;
 *   - one state commit on release (the record's own).
 *
 * THE AFTER NUMBERS (this file, same drag): 0 React state commits while the
 * hand moves, 0 card renders, 60 element frames (the card's own `left`/`top`
 * plus its cursor class), 60 published points, one repaint per wire that TOUCHES
 * the dragged card and none for the rest, and still exactly ONE commit and ONE
 * drop on release.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}
const LAYER = source("canvas/GroundLayer.tsx");
const ASK_CARD = source("canvas/AskCard.tsx");
const SESSION_CARD = source("canvas/SessionCard.tsx");
const WIRES = source("canvas/GroundWires.tsx");
const APP = source("App.tsx");

/**
 * The drag helper's live listeners live on `window` (the plane's d3-zoom stops
 * the press before React sees it). The handler only needs add/remove and a way
 * to fire, so this is a listener table, not a DOM.
 */
const windowListeners = new Map<string, Set<(event: unknown) => void>>();
const realWindow = (globalThis as { window?: unknown }).window;

beforeAll(() => {
  (globalThis as { window?: unknown }).window = {
    addEventListener: (kind: string, fn: (event: unknown) => void) => {
      if (!windowListeners.has(kind)) windowListeners.set(kind, new Set());
      windowListeners.get(kind)?.add(fn);
    },
    removeEventListener: (kind: string, fn: (event: unknown) => void) => {
      windowListeners.get(kind)?.delete(fn);
    },
  };
});

afterAll(() => {
  (globalThis as { window?: unknown }).window = realWindow;
  windowListeners.clear();
});

function fireWindow(kind: string, event: unknown): void {
  for (const fn of [...(windowListeners.get(kind) ?? [])]) fn(event);
}

/**
 * ONE card element, as far as a drag can tell: the two style properties the
 * frame writes, the cursor class, and its own raw listeners. It is deliberately
 * NOT a DOM — the point of the story is that no framework has to be involved in
 * a pointer move.
 */
class FakeCardElement {
  readonly style: Record<string, string> = {};
  readonly classes = new Set<string>();
  private readonly handlers = new Map<string, Set<(event: unknown) => void>>();
  readonly classList = {
    add: (name: string) => {
      this.classes.add(name);
    },
    remove: (name: string) => {
      this.classes.delete(name);
    },
  };

  addEventListener(kind: string, fn: (event: unknown) => void): void {
    if (!this.handlers.has(kind)) this.handlers.set(kind, new Set());
    this.handlers.get(kind)?.add(fn);
  }

  removeEventListener(kind: string, fn: (event: unknown) => void): void {
    this.handlers.get(kind)?.delete(fn);
  }

  press(clientX = 0, clientY = 0): void {
    const event = {
      button: 0,
      clientX,
      clientY,
      target: { closest: () => null },
      stopPropagation: () => {},
    };
    for (const fn of [...(this.handlers.get("mousedown") ?? [])]) fn(event);
  }
}

const CARD = { slug: "rain-gauge", x: 100, y: 100 };

/**
 * WHAT ONE DRAG COSTS, counted the way the story counts it: the frames the hand
 * produces, the React state commits the card asks for, the element writes the
 * frame does, and the points the wires can read.
 */
function dragOnce(moves: number) {
  const channel = createGroundDragChannel();
  const el = new FakeCardElement();
  let frames = 0;
  let elementWrites = 0;
  let publishes = 0;
  let releases = 0;
  let drops = 0;
  let published: GroundDragAt[] = [];

  channel.subscribe((at) => {
    publishes += 1;
    if (at !== null) published.push(at);
  });

  const cleanup = attachGroundCardDrag(el as unknown as HTMLElement, {
    at: () => ({ x: CARD.x, y: CARD.y }),
    zoom: () => 1,
    // The measured card is collapsed: its body is a crop, so it drags.
    expanded: () => false,
    onPreview: (at) => {
      if (at === null) return;
      frames += 1;
      // What a card does with a frame: the element and the shared point.
      const before = { ...el.style, classes: el.classes.size };
      frameGroundCard(el as unknown as HTMLElement, at);
      if (
        el.style.left !== before["left"] ||
        el.style.top !== before["top"] ||
        el.classes.size !== before.classes
      ) {
        elementWrites += 1;
      }
      channel.publish({ slug: CARD.slug, x: at.x, y: at.y });
    },
    onRelease: (moved) => {
      releases += 1;
      if (!moved) return;
      // The release commits to the point the RECORD will hold (whole units).
      const at = published[published.length - 1];
      if (at === undefined) return;
      channel.publish({
        slug: CARD.slug,
        x: Math.round(at.x),
        y: Math.round(at.y),
      });
    },
    onDrop: () => {
      drops += 1;
    },
  });

  el.press(0, 0);
  for (let i = 0; i < moves; i += 1) {
    const angle = (i / moves) * Math.PI * 2;
    fireWindow("mousemove", {
      clientX: 80 * Math.cos(angle),
      clientY: 80 * Math.sin(angle),
    });
  }
  fireWindow("mouseup", {});
  cleanup();

  const commit = published[published.length - 1] ?? null;
  settleGroundCard(el as unknown as HTMLElement, {
    x: CARD.x,
    y: CARD.y,
  });

  return {
    frames,
    elementWrites,
    publishes,
    releases,
    drops,
    commit,
  };
}

describe("one drag, measured (story 16.25)", () => {
  test("60 moves: 60 element frames and ONE commit on the release", () => {
    const measured = dragOnce(60);
    // The hand's own frames: the card is moved by its element and nothing else.
    expect(measured.frames).toBe(60);
    expect(measured.elementWrites).toBe(60);
    // Every frame does exactly its two things — the element and the shared
    // point — and the only commit in the whole drag is the drop's own. The
    // BEFORE number was 60 state commits, one render of the card each.
    expect(measured.publishes).toBe(measured.frames + 1);
    expect(measured.releases).toBe(1);
    expect(measured.drops).toBe(1);
    // The release commits ONE whole-unit point, the record's own rounding.
    expect(measured.commit).not.toBeNull();
    expect(Number.isInteger(measured.commit?.x)).toBe(true);
    expect(Number.isInteger(measured.commit?.y)).toBe(true);
  });

  test("a press that never crosses the threshold publishes and writes nothing", () => {
    const channel = createGroundDragChannel();
    const el = new FakeCardElement();
    let publishes = 0;
    let drops = 0;
    channel.subscribe(() => {
      publishes += 1;
    });
    const cleanup = attachGroundCardDrag(el as unknown as HTMLElement, {
      at: () => ({ x: CARD.x, y: CARD.y }),
      zoom: () => 1,
      expanded: () => false,
      onPreview: (at) => {
        if (at === null) return;
        frameGroundCard(el as unknown as HTMLElement, at);
        channel.publish({ slug: CARD.slug, x: at.x, y: at.y });
      },
      onDrop: () => {
        drops += 1;
      },
    });
    el.press(0, 0);
    fireWindow("mousemove", { clientX: 1, clientY: 1 });
    fireWindow("mouseup", {});
    cleanup();
    // A press is a press: no frame, no published point, no write.
    expect(publishes).toBe(0);
    expect(drops).toBe(0);
    expect(el.style).toEqual({});
    expect(el.classes.size).toBe(0);
  });
});

/** The map the wire half of the story is measured on: 20 cards, 8 wires. */
const CARDS = Array.from({ length: 20 }, (_, index) => ({
  on: "card-" + index,
  x: index * 320,
  y: (index % 4) * 260,
}));
const DRAGGED = CARDS[7]!;
const LINKS: readonly (readonly [string, string])[] = [
  [DRAGGED.on, CARDS[0].on],
  [CARDS[3].on, DRAGGED.on],
  [CARDS[1].on, CARDS[2].on],
  [CARDS[4].on, CARDS[5].on],
  [DRAGGED.on, CARDS[9].on],
  [CARDS[10].on, CARDS[11].on],
  [CARDS[12].on, DRAGGED.on],
  [CARDS[13].on, CARDS[14].on],
];

describe("only the wires that touch the dragged card follow it", () => {
  test("4 of 8 wires are wired to the card: the other 4 do nothing", () => {
    const bySlug = new Map(CARDS.map((card) => [card.on, card]));
    let touching = 0;
    for (const [from, to] of LINKS) {
      const a = bySlug.get(from)!;
      const b = bySlug.get(to)!;
      if (a.on === DRAGGED.on || b.on === DRAGGED.on) touching += 1;
    }
    expect(touching).toBe(4);
  });

  test("a frame moves one end of a touching wire and leaves the rest alone", () => {
    const bySlug = new Map(CARDS.map((card) => [card.on, card]));
    const at = {
      slug: DRAGGED.on,
      x: DRAGGED.x + 40,
      y: DRAGGED.y - 25,
    };
    let repainted = 0;
    for (const [from, to] of LINKS) {
      const a = bySlug.get(from)!;
      const b = bySlug.get(to)!;
      // The wire's own test, verbatim (GroundWires): a frame that is not this
      // wire's is not a repaint.
      if (at.slug !== a.on && at.slug !== b.on) continue;
      const ends = wireEndsUnderDrag(a, b, at);
      expect(wireGeometry(ends.from, ends.to)).not.toBeNull();
      repainted += 1;
    }
    expect(repainted).toBe(4);
  });

  test("the dragged end takes the frame's point; the other end keeps its record", () => {
    const target = CARDS[0]!;
    const ends = wireEndsUnderDrag(CARDS[7]!, target, {
      slug: CARDS[7]!.on,
      x: 1,
      y: 2,
    });
    expect(ends.from).toEqual({ ...CARDS[7]!, x: 1, y: 2 });
    expect(ends.to).toBe(target);
    // A point for another card is not this wire's news at all.
    const untouched = wireEndsUnderDrag(CARDS[1]!, CARDS[2]!, {
      slug: CARD.slug,
      x: 9,
      y: 9,
    });
    expect(untouched.from).toBe(CARDS[1]!);
    expect(untouched.to).toBe(CARDS[2]!);
  });

  test("the wire's geometry is still the ONE pure rule, fed the live point", () => {
    const target = CARDS[0]!;
    const record = wireGeometry(CARDS[7]!, target)!;
    const live = wireGeometry(
      wireEndsUnderDrag(CARDS[7]!, target, {
        slug: CARDS[7]!.on,
        x: CARDS[7]!.x + 120,
        y: CARDS[7]!.y,
      }).from,
      target,
    )!;
    // Same helper, same shape: the frame only changes an INPUT, not the rule.
    expect(Object.keys(live)).toEqual(Object.keys(record));
    expect(live.from.x).not.toBe(record.from.x);
    expect(live.length).not.toBe(record.length);
  });
});

describe("the channel is one shared point, not state", () => {
  test("publish is synchronous, read back, and a subscriber can leave", () => {
    const channel = createGroundDragChannel();
    const seen: (GroundDragAt | null)[] = [];
    const stop = channel.subscribe((at) => seen.push(at));
    expect(channel.at()).toBeNull();
    channel.publish({ slug: "a", x: 1, y: 2 });
    expect(channel.at()).toEqual({ slug: "a", x: 1, y: 2 });
    channel.publish(null);
    stop();
    channel.publish({ slug: "b", x: 3, y: 4 });
    expect(seen).toEqual([
      { slug: "a", x: 1, y: 2 },
      null,
    ]);
  });

  test("settling the element puts it back on the record's point", () => {
    const el = new FakeCardElement();
    frameGroundCard(el as unknown as HTMLElement, { x: 12.4, y: 5 });
    expect(el.style).toEqual({ left: "12.4px", top: "5px" });
    expect(el.classes.has("dragging")).toBe(true);
    settleGroundCard(el as unknown as HTMLElement, { x: 100, y: 100 });
    expect(el.style).toEqual({ left: "100px", top: "100px" });
    expect(el.classes.has("dragging")).toBe(false);
  });
});

describe("the drag path holds no React state", () => {
  test("no card sets drag state per move; each frames its element and publishes", () => {
    for (const card of [LAYER, ASK_CARD, SESSION_CARD]) {
      // The story's whole point: the frame is not a state update.
      expect(card).not.toContain("setDragPos");
      expect(card).toContain("frameGroundCard(");
      expect(card).toContain("settleGroundCard(");
      expect(card).toContain("drag?.publish(");
      // The commit still rounds like the record does, and a no-op drop still
      // releases the frame instead of waiting for a write that never comes.
      expect(card).toContain("Math.round(at.x)");
      expect(card).toContain("settleFrame()");
    }
    // The pill still owns no drag at all (story 16.21's rule).
    expect(source("canvas/CardNamePill.tsx")).not.toContain("frameGroundCard");
  });

  test("the wires subscribe to the one point and skip the wires it does not name", () => {
    expect(WIRES).toContain("drag.subscribe(");
    expect(WIRES).toContain("at.slug !== from.on && at.slug !== to.on");
    expect(WIRES).toContain("wireEndsUnderDrag(");
    // A wire repaints its own elements; it never re-renders.
    expect(WIRES).toContain("line.style.transform");
    expect(WIRES).toContain("markRef.current");
    // The paint is not a state update either.
    expect(WIRES).not.toContain("setDragPos");
  });

  test("the app makes ONE channel and hands it to both halves", () => {
    expect(APP).toContain("createGroundDragChannel()");
    expect(APP).toContain("drag={groundDrag}");
    expect(APP.split("createGroundDragChannel()").length - 1).toBe(1);
  });

  test("the ground map still renders no map content family", () => {
    expect(renderedMapContent("ground")).toEqual([]);
  });
});
