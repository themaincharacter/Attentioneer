import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { authoringLive } from "../src/canvas/gates";
import { outOfPlay, type PlayingSet } from "../src/map/model";

/**
 * Epic 7 story 1 — the circle's honesty in code, asserted without a DOM.
 *
 * The story has two halves and both are pure rules:
 *
 * - the required-set rule made STRUCTURAL: `authoringLive` is the seam, and the
 *   three dynamics writers (a link, a loop, an assumption) ask it before their
 *   first write. The three affordances that would arm them ask it too, so a
 *   gesture is never spent on a dead end — the echo, not the rule;
 * - the DRAFT reading: `outOfPlay` decides what the plane shows — the selector's
 *   draft while it is open, the accepted record when it is closed — so a
 *   re-included word undims before close, and ONE wash (never two) says the
 *   exclusion.
 *
 * The record layer is untouched by this story: nothing here writes, and the
 * membership joins stay joinWord-friendly. The look and the feel remain the
 * human check.
 */

const play = (...words: string[]): PlayingSet => ({ words, extra: {} });

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** One `const NAME = useCallback(` block, up to its closing `);`. */
function callbackBody(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = useCallback(`);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n  );", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + 4);
}

/** One CSS rule's declaration block, matched on the exact selector text. */
function cssRule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThan(-1);
  const end = css.indexOf("}", start);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end + 1);
}

const useMapSource = read("../src/canvas/useMap.ts");
const appSource = read("../src/App.tsx");
const cssSource = read("../src/canvas/canvas.css");
const selectorSource = read("../src/canvas/PlayingSetSelector.tsx");
const modelSource = read("../src/map/model.ts");
const gatesSource = read("../src/canvas/gates.ts");

describe("authoringLive — the required set is structural (Epic 7 story 1)", () => {
  const LEVELS = ["concept", "dynamics", "ground"] as const;

  test("dynamics authors only with an ACCEPTED set; every other game always authors", () => {
    for (const level of LEVELS) {
      expect(authoringLive(level, play("rain"))).toBe(true);
    }
    expect(authoringLive("dynamics", null)).toBe(false);
    expect(authoringLive("concept", null)).toBe(true);
    expect(authoringLive("ground", null)).toBe(true);
  });

  test("an accepted EMPTY set is still an accepted set", () => {
    // The narrowing is the human's (ADR-0013 decision 2): "play with nothing" is
    // a choice the person may make, and it is not the state "no set" — the doors
    // are open, there is simply nothing in play to author about.
    expect(authoringLive("dynamics", play())).toBe(true);
  });

  test("the rule is the game's, not a word's: membership never decides authoring", () => {
    // A set naming words nobody can see still arms the game: the writers author
    // records and never validate membership (ADR-0013's no-validation posture).
    expect(authoringLive("dynamics", play("gone", "vanished"))).toBe(true);
  });

  test("Level 1 is untouched by construction: the level short-circuits before the model", () => {
    const start = gatesSource.indexOf("export function authoringLive");
    const body = gatesSource.slice(start, gatesSource.indexOf("\n}", start));
    expect(body).toContain('level !== "dynamics"');
    expect(body).not.toContain(".words");
    expect(body).not.toContain("hasWord");
    // Concept and ground take the same branch: nothing about them can vary.
    expect(authoringLive("concept", null)).toBe(authoringLive("ground", null));
  });
});

describe("the three dynamics writers ask the seam before they write", () => {
  test("drawLink is guarded before its link write", () => {
    const body = callbackBody(useMapSource, "drawLink");
    expect(body).toContain("authoringLive(level, modelRef.current)");
    expect(body.indexOf("authoringLive(")).toBeLessThan(body.indexOf("persistLinks("));
    expect(body.indexOf("authoringLive(")).toBeLessThan(body.indexOf("joinToPlay("));
  });

  test("createLoop is guarded before its loop write", () => {
    const body = callbackBody(useMapSource, "createLoop");
    expect(body).toContain("authoringLive(level, modelRef.current)");
    expect(body.indexOf("authoringLive(")).toBeLessThan(body.indexOf("persistLoops("));
  });

  test("addAssumption is guarded before its assumption write", () => {
    const body = callbackBody(useMapSource, "addAssumption");
    expect(body).toContain("authoringLive(level, modelRef.current)");
    expect(body.indexOf("authoringLive(")).toBeLessThan(
      body.indexOf("persistAssumptions("),
    );
  });

  test("all three no-op: the guard RETURNS before the first persist, never after", () => {
    const writers: Array<[string, string]> = [
      ["drawLink", "persistLinks("],
      ["createLoop", "persistLoops("],
      ["addAssumption", "persistAssumptions("],
    ];
    for (const [name, persist] of writers) {
      const body = callbackBody(useMapSource, name);
      const guard = body.indexOf("if (!authoringLive(");
      expect(guard).toBeGreaterThan(-1);
      expect(body.slice(guard, body.indexOf(persist))).toContain("return;");
      expect(guard).toBeLessThan(body.indexOf(persist));
    }
  });

  test("the seam reads the synchronous mirror, and accept writes it", () => {
    expect(useMapSource).toContain("authoringLive(level, modelRef.current)");
    // The accept is what arms the writers: it must land on the mirror the seam
    // reads, not one render later.
    const accept = callbackBody(useMapSource, "acceptPlayingSet");
    expect(accept).toContain("modelRef.current = next;");
    expect(accept.indexOf("modelRef.current = next;")).toBeLessThan(
      accept.indexOf("saveModel("),
    );
  });

  test("the level has ONE source in the map hook (the band's game)", () => {
    expect(useMapSource).toContain('const level = options.level ?? "concept";');
    expect(useMapSource).toContain('const playing = level === "dynamics";');
    expect(useMapSource).not.toContain("options.playing");
    expect(appSource).toContain('useMap(workspace?.path ?? "", { level })');
  });

  test("the every-game writers stay ungated: words, distances and marks", () => {
    // The honest partition: only dynamics' OWN records need a playing set. A
    // word, a distance and a mark are written in every game, so gating them
    // would quietly change Level 1 and the ground game.
    for (const name of [
      "updateReference",
      "coinConnect",
      "castMark",
      "growMark",
      "toggleWordMark",
    ]) {
      expect(callbackBody(useMapSource, name)).not.toContain("authoringLive");
    }
    // Joining membership is a record join, never an authoring move (ADR-0013
    // decision 4): a link to a pruned word still rejoins it once it is drawn.
    expect(callbackBody(useMapSource, "joinToPlay")).not.toContain("authoringLive");
  });

  test("the three affordances echo the seam before they arm", () => {
    const armed: Array<[string, string]> = [
      ["openAssumptions", "setAssumptionAt("],
      ["beginLoop", "setPathSession("],
      ["beginConnectLive", "beginConnect("],
    ];
    for (const [name, call] of armed) {
      const body = callbackBody(appSource, name);
      expect(body).toContain("authoringLive(level, model)");
      expect(body.indexOf("authoringLive(")).toBeLessThan(body.indexOf(call));
    }
    // The connect handle is the shared Level 1 gesture: it still starts a draw in
    // every other game, because the rule returns live there.
    expect(appSource).toContain("onConnectFrom={beginConnectLive}");
    expect(appSource).not.toContain("onConnectFrom={(slug, c) => beginConnect(");
  });
});

describe("the draft predicate: the selector's draft vs the accepted model", () => {
  const accepted = play("rain", "soil");

  test("closed: the accepted record decides, and no set means nothing is out", () => {
    expect(outOfPlay(accepted, null, "rain")).toBe(false);
    expect(outOfPlay(accepted, null, "soil")).toBe(false);
    expect(outOfPlay(accepted, null, "mulch")).toBe(true);
    // No accepted set: every word renders unchanged (the pre-set state).
    expect(outOfPlay(null, null, "rain")).toBe(false);
    expect(outOfPlay(null, null, "mulch")).toBe(false);
  });

  test("open: the DRAFT decides, so a prune quiets at once", () => {
    const draft = new Set(["rain"]);
    expect(outOfPlay(accepted, draft, "rain")).toBe(false);
    expect(outOfPlay(accepted, draft, "soil")).toBe(true);
    expect(outOfPlay(accepted, draft, "mulch")).toBe(true);
  });

  test("open: a re-included word reads in play BEFORE close (the defect settled)", () => {
    // The defect: out-of-set was read from the accepted record, so a word clicked
    // back in stayed dimmed until accept. The draft is the reading now.
    const pruned = new Set(["rain"]);
    expect(outOfPlay(accepted, pruned, "soil")).toBe(true);
    const reIncluded = new Set(["rain", "soil"]);
    expect(outOfPlay(accepted, reIncluded, "soil")).toBe(false);
  });

  test("open: the draft beats the accepted record in BOTH directions", () => {
    // An accepted set wider than the draft: the draft narrows the read.
    expect(outOfPlay(play("rain", "soil", "mulch"), new Set(["rain"]), "mulch")).toBe(true);
    // An accepted set narrower than the draft: the draft widens it live.
    expect(outOfPlay(play("rain"), new Set(["rain", "soil"]), "soil")).toBe(false);
    // An empty draft is a draft: on a first entry every word clicked out is out.
    expect(outOfPlay(null, new Set(), "rain")).toBe(true);
    expect(outOfPlay(play("rain"), new Set(), "rain")).toBe(true);
  });

  test("the draft is a view, never a record: the accepted set is left alone", () => {
    const before = play("rain", "soil");
    const draft = new Set(["rain"]);
    outOfPlay(before, draft, "soil");
    expect(before.words).toEqual(["rain", "soil"]);
    expect([...draft]).toEqual(["rain"]);
  });

  test("the plane renders the draft while the selector is open, the record when it is not", () => {
    expect(appSource).toContain(
      "outOfPlay(model, selectorOpen ? selectorDraft : null, word.slug)",
    );
    // The stale reading is gone: out-of-set is no longer read from the accepted
    // set behind the draft's back.
    expect(appSource).not.toContain("hasWord(model, word.slug)");
  });
});

describe("one wash, two signals (the exclusion rendering rules)", () => {
  test("the word's own quiet is the one wash: 0.42, live from the draft", () => {
    expect(cssRule(cssSource, ".word.out-of-set")).toContain("opacity: 0.42");
    // Hover still un-quiets: this is never a disabled state.
    expect(cssRule(cssSource, ".word.out-of-set:hover")).toContain("opacity: 1");
  });

  test("the selector layer adds the ring and the border only — never a second wash", () => {
    const rule = cssRule(cssSource, ".playing-set-word.out");
    // No second pale wash and no second opacity: the word's dim already says it.
    expect(rule).toContain("background: transparent");
    expect(rule).not.toContain("opacity");
    expect(cssSource).not.toContain("rgba(247, 246, 243, 0.66)");
    // The exclusion marker itself survives: a dashed hollow ring, never the ×.
    const ringAt = cssSource.indexOf(".playing-set-word.out::after");
    expect(ringAt).toBeGreaterThan(-1);
    expect(cssSource.slice(ringAt, cssSource.indexOf("}", ringAt))).toContain(
      "border: 1.2px dashed",
    );
  });

  test("shelved × out-of-set is ONE combined quiet, not a product (~0.21)", () => {
    // The collision has its own value: quieter than either alone, still readable.
    expect(cssRule(cssSource, ".word.shelved.out-of-set")).toContain("opacity: 0.35");
    // Hover still un-quiets the collision (the shelf's own hover value).
    expect(cssRule(cssSource, ".word.shelved.out-of-set:hover")).toContain(
      "opacity: 0.85",
    );
    // The shelf's own quiet is untouched for the ordinary set-aside word.
    expect(cssRule(cssSource, ".word.shelved")).toContain("opacity: 0.5");
  });

  test("excluded + marked keeps its italic/dashed-underline readable under the dim", () => {
    // The mark's ink comes from .word.open .word-name and is never removed.
    const marked = cssRule(cssSource, ".word.open .word-name");
    expect(marked).toContain("font-style: italic");
    expect(marked).toContain("text-decoration: underline dashed");
    // The collision deepens that ink and lifts the dim, so the mark still reads.
    expect(cssRule(cssSource, ".word.out-of-set.open")).toContain("opacity: 0.7");
    expect(cssRule(cssSource, ".word.out-of-set.open .word-name")).toContain(
      "color: #6b6558",
    );
    expect(cssRule(cssSource, ".word.out-of-set.open:hover")).toContain("opacity: 1");
  });
});

describe("the stale lines are retired (Epic 7 story 1's inventory)", () => {
  const adr = (name: string) => read(`../../adr/${name}`);

  test("the selector's doc no longer says relationships stay Epic 7's", () => {
    expect(selectorSource).not.toContain("relationships stay Epic 7's");
    expect(selectorSource).toContain("the relationship form dissolved");
    // And the layer doc no longer promises a second wash.
    expect(selectorSource).not.toContain("sits behind a pale wash");
  });

  test("model.ts no longer says the selector opens before play", () => {
    expect(modelSource).not.toContain("opens before play");
    expect(modelSource).toContain("only a DELIBERATE entry asks for it");
    // The draft predicate is documented as a view, never a record.
    expect(modelSource).toContain("A draft is a VIEW, never a record");
  });

  test("the canvas no longer washes an excluded word twice", () => {
    expect(cssSource).not.toContain("sits behind a pale wash");
    expect(cssSource).toContain("ONE wash, two signals");
  });

  test("ADR-0013 carries its retirements, and its broken note is re-hung", () => {
    const source = adr("adr-0013-the-playing-set-is-literal.md");
    // The pre-reshape parenthetical is retired where it stands: the circle's
    // word form IS this selection; the rest dissolved.
    expect(source).not.toContain("(Epic 7's tool, not its rhythm)");
    expect(source).toContain("the circle's word form IS this selection");
    // The note that once aborted a batch is no longer spliced into the sentence:
    // "reshapes *(Retired ...)* at its own epic" is gone, and the rhythm's
    // sentence ends normally before its note.
    expect(source).not.toContain("and reshapes *(Retired");
    expect(source).toContain("at its own\n   epic. *(Retired 2026-11-15");
    // Decision 7, the consequence and the out-of-scope item each carry the note.
    expect((source.match(/Retired 2026-11-15/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(source).not.toContain("reshapes *(Retired");
  });

  test("ADR-0016's two stale spots are retired, the decision's claim replaced", () => {
    const source = adr("adr-0016-level-2-is-a-mode.md");
    expect(source).not.toContain("relationship selection stays Epic 7's");
    expect(source).toContain(
      "the playing-set selector is **words only** *(Retired 2026-11-15",
    );
    // Its out-of-scope item carries the note too (the words stay, the claim dies).
    expect(source).toContain("the slice, provisional. *(Retired 2026-11-15");
    // Exactly the two new notes, beside the context's earlier update.
    expect((source.match(/Retired 2026-11-15/g) ?? []).length).toBe(2);
    expect(source).toContain("the circle's word form is the selector");
  });

  test("ADR-0018's amendment points at the dissolved ground, not a live ticket", () => {
    const source = adr("adr-0018-zoom-is-the-level.md");
    expect(source).not.toContain("only the relationship form remains unconsumed");
    expect(source).not.toContain("that is the relationship-selection ticket's ground");
    expect(source).toContain("the relationship form dissolved at Epic 7 as well");
    expect(source).toContain("no part of the circle gesture remains unconsumed");
    // The amendment still names where it came from.
    expect(source).toContain("01-the-reshape-what-the-magic-circle-is-now.md");
  });
});
