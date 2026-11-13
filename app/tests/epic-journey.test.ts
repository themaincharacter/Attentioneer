import { describe, expect, test } from "bun:test";
import { DEFAULT_BOX } from "../src/canvas/geometry";
import { parseYamlFields, slugName, workspaceYml } from "../src/lib/serialize";
import {
  coinDistance,
  distanceKey,
  parseDistances,
  serializeDistances,
  type Distance,
} from "../src/map/distances";
import {
  findOrphanMarks,
  hasMark,
  parseMarks,
  retargetMark,
  serializeMarkLine,
  serializeMarks,
  withMark,
  withoutMark,
  type Mark,
  type MarkTarget,
} from "../src/map/marks";
import { parseReference, serializeReference, type Reference } from "../src/map/refs";
import {
  DEFAULT_SHELF_X,
  SHELF_MARGIN,
  isShelved,
  rejectSpot,
  shelfXOf,
} from "../src/map/shelf";

/**
 * The epic's plain-language check, automated at the record layer (story 4).
 *
 * The human half — the feel of a click, a ring, a drag across the fold, the
 * native quit/reopen — is not asserted here. This file walks the same journey
 * through the pure modules the app uses and through the files' bytes only:
 * a small real subject mapped; a distinction captured as two words and a cut
 * word (dissolved ticket 05); a felt lack cast and grown into an unresolved
 * question-word (dissolved ticket 04); a tentative alternative set aside; a
 * possibility rejected; marks bound to a word and to a wire; then quit/reopen,
 * the revisits, and the settling. Every file must re-read byte-for-byte, no
 * mark may dangle, and the shelf must read by position alone — nothing counted
 * or queued.
 */

const FOLD = DEFAULT_SHELF_X;
const WORD_WIDTH = DEFAULT_BOX.w;
const REFS = "map/references/";

type Files = Record<string, string>;

interface Journey {
  refs: readonly Reference[];
  distances: readonly Distance[];
  marks: readonly Mark[];
  /** Hand-edited lines the app cannot read — carried verbatim, never dropped. */
  malformedMarks: readonly string[];
}

const word = (slug: string): MarkTarget => ({ type: "word", slug });
const wire = (from: string, to: string, word: string): MarkTarget => ({
  type: "wire",
  from,
  to,
  word,
});
const spot = (x: number, y: number): MarkTarget => ({ type: "spot", x, y });
const open = (target: MarkTarget): Mark => ({ kind: "open", target, extra: {} });

function reference(
  name: string,
  slug: string,
  x: number,
  y: number,
  body = "",
): Reference {
  return { id: slug, slug, name, x, y, body, extra: {} };
}

/** Cast an open mark; a re-cast of the same target is the same line. */
function cast(marks: readonly Mark[], target: MarkTarget): readonly Mark[] {
  return hasMark(marks, "open", target) ? marks : withMark(marks, open(target));
}

/** The app's ring drop: move the one mark from a spot onto a word or wire. */
function bind(marks: readonly Mark[], from: MarkTarget, to: MarkTarget): readonly Mark[] {
  return retargetMark(marks, from, to);
}

/** Write the journey's memory to the workspace's files (the app's writes). */
function write(journey: Journey): Files {
  const files: Files = {
    "workspace.yml": workspaceYml(),
    "map/distances.jsonl": serializeDistances(journey.distances),
    "map/marks.jsonl": serializeMarks(journey.marks, journey.malformedMarks),
  };
  for (const ref of journey.refs) {
    if (ref.slug === null) throw new Error("an uncoined reference cannot be written");
    files[`${REFS}${ref.slug}.md`] = serializeReference(ref);
  }
  return files;
}

/**
 * Quit and reopen: read every file back and confirm the app's next write is
 * the same bytes. This is the epic check's "the map reads exactly as left",
 * asserted at the record level.
 */
function reopen(files: Files): Journey {
  const refs: Reference[] = [];
  const paths = Object.keys(files)
    .filter((path) => path.startsWith(REFS) && path.endsWith(".md"))
    .sort();
  for (const path of paths) {
    const text = files[path];
    const slug = path.slice(REFS.length, -3);
    const parsed = parseReference(slug, slug, text);
    expect(serializeReference(parsed)).toBe(text);
    refs.push(parsed);
  }

  const distText = files["map/distances.jsonl"];
  const parsedDistances = parseDistances(distText);
  expect(parsedDistances.malformed).toEqual([]);
  expect(serializeDistances(parsedDistances.distances)).toBe(distText);

  const markText = files["map/marks.jsonl"];
  const parsedMarks = parseMarks(markText);
  expect(serializeMarks(parsedMarks.marks, parsedMarks.malformed)).toBe(markText);

  return {
    refs,
    distances: parsedDistances.distances,
    marks: parsedMarks.marks,
    malformedMarks: parsedMarks.malformed,
  };
}

/** Marks whose target is not on the map — genuine dangling marks. */
function orphans(journey: Journey): Mark[] {
  const slugs = new Set(
    journey.refs.map((ref) => ref.slug).filter((slug): slug is string => slug !== null),
  );
  const wireKeys = new Set(
    journey.distances.map((d) => distanceKey(d.from, d.to, d.word)),
  );
  return findOrphanMarks(journey.marks, slugs, wireKeys);
}

/** The person maps a small real subject: the handful of words (ADR-0007). */
function mappedSubject(): Journey {
  return {
    refs: [
      reference(
        "rain",
        "rain",
        220,
        180,
        "the water that arrives without being asked\n",
      ),
      reference("tap water", "tap-water", 520, 180),
      reference("soil", "soil", 360, 320),
      reference("mulch", "mulch", 700, 320),
      reference("sprinkler", "sprinkler", 880, 340),
    ],
    distances: [],
    marks: [],
    malformedMarks: [],
  };
}

/**
 * A distinction captured as the composed move (dissolved ticket 05): two named
 * sides and one distance whose coined word names the cut. No cut-first
 * placeholder, no kind, no extra record.
 */
function withDistinction(journey: Journey): Journey {
  return {
    ...journey,
    distances: coinDistance(journey.distances, "rain", "tap-water", "vs"),
  };
}

/**
 * A tentative alternative set aside (ADR-0010): one open mark on the word and
 * a plain position past the fold. The word's centre — not its left edge —
 * crosses the fold; no shelf flag is written anywhere.
 */
function withTentativeOnShelf(journey: Journey): Journey {
  const refs = journey.refs.map((ref) =>
    ref.slug === "mulch" ? { ...ref, x: FOLD - 20 } : ref,
  );
  return { ...journey, refs, marks: withMark(journey.marks, open(word("mulch"))) };
}

/**
 * Rejection as one composed move (ADR-0010): settle the open mark and set the
 * word aside at the derived shelf spot. The word is kept as a settled "no".
 */
function withRejection(journey: Journey): Journey {
  const marked = withMark(journey.marks, open(word("sprinkler")));
  const sprinkler = journey.refs.find((ref) => ref.slug === "sprinkler");
  if (!sprinkler) throw new Error("the journey must coin the rejected word first");
  const shelfSpot = rejectSpot(
    { x: sprinkler.x, y: sprinkler.y, width: WORD_WIDTH },
    FOLD,
  );
  if (!shelfSpot) throw new Error("the rejected word was already set aside");
  const refs = journey.refs.map((ref) =>
    ref.slug === "sprinkler" ? { ...ref, ...shelfSpot } : ref,
  );
  return {
    ...journey,
    refs,
    marks: withoutMark(marked, "open", word("sprinkler")),
  };
}

/**
 * The felt lack (dissolved ticket 04): a bare spot, then grown into a named
 * question-word in one composed move. The mark follows the spot to the word
 * and stays open — the question is left unresolved.
 */
function withUnresolvedQuestion(journey: Journey): Journey {
  const at = { x: 560, y: 470 };
  const name = "why does rain miss the soil?";
  const question = reference(name, slugName(name), at.x, at.y);
  return {
    ...journey,
    refs: [...journey.refs, question],
    marks: bind(
      cast(journey.marks, spot(at.x, at.y)),
      spot(at.x, at.y),
      word(question.slug!),
    ),
  };
}

/** Marks bound to the other two target forms: a word and a wire. */
function withBoundMarks(journey: Journey): Journey {
  const onWord = bind(
    cast(journey.marks, spot(1000, 500)),
    spot(1000, 500),
    word("soil"),
  );
  const onWire = bind(
    cast(onWord, spot(1040, 520)),
    spot(1040, 520),
    wire("rain", "tap-water", "vs"),
  );
  return { ...journey, marks: onWire };
}

function fullJourney(): Journey {
  return withBoundMarks(
    withUnresolvedQuestion(
      withRejection(withTentativeOnShelf(withDistinction(mappedSubject()))),
    ),
  );
}

describe("the epic's record-level journey", () => {
  test("map the subject: a handful of words and a distinction as two words and a cut word", () => {
    const journey = withDistinction(mappedSubject());
    const files = write(journey);
    const reopened = reopen(files);

    expect(reopened.refs.map((ref) => ref.name).sort()).toEqual([
      "mulch",
      "rain",
      "soil",
      "sprinkler",
      "tap water",
    ]);
    // The distinction is exactly the composed move: two sides + the cut word.
    expect(files["map/distances.jsonl"]).toBe(
      '{"from":"rain","to":"tap-water","word":"vs"}\n',
    );
    expect(reopened.distances).toEqual([
      { from: "rain", to: "tap-water", word: "vs", extra: {} },
    ]);
    expect(reopened.marks).toEqual([]);
    expect(orphans(reopened)).toEqual([]);
    // The memory is prose, byte-verbatim.
    expect(reopened.refs.find((ref) => ref.slug === "rain")!.body).toBe(
      "the water that arrives without being asked\n",
    );
  });

  test("a tentative alternative is deferred on the shelf; another possibility is rejected", () => {
    const journey = withRejection(
      withTentativeOnShelf(withDistinction(mappedSubject())),
    );
    const files = write(journey);
    const reopened = reopen(files);

    const mulch = reopened.refs.find((ref) => ref.slug === "mulch")!;
    const sprinkler = reopened.refs.find((ref) => ref.slug === "sprinkler")!;

    // Deferred: set aside by position, still carrying its open mark.
    expect(isShelved(mulch.x, WORD_WIDTH, FOLD)).toBe(true);
    expect(hasMark(reopened.marks, "open", word("mulch"))).toBe(true);

    // Rejected: kept, settled, in the shelf column — position is the record.
    expect(sprinkler.x).toBe(FOLD + SHELF_MARGIN);
    expect(isShelved(sprinkler.x, WORD_WIDTH, FOLD)).toBe(true);
    expect(hasMark(reopened.marks, "open", word("sprinkler"))).toBe(false);
    expect(serializeReference(sprinkler)).not.toContain("shelf");
    expect(sprinkler.extra).toEqual({});

    // One mark line, and no side file for the shelf or for a queue.
    expect(files["map/marks.jsonl"]).toBe('{"kind":"open","on":"mulch"}\n');
    expect(Object.keys(files).sort()).toEqual([
      "map/distances.jsonl",
      "map/marks.jsonl",
      "map/references/mulch.md",
      "map/references/rain.md",
      "map/references/soil.md",
      "map/references/sprinkler.md",
      "map/references/tap-water.md",
      "workspace.yml",
    ]);
    expect(orphans(reopened)).toEqual([]);
  });

  test("the felt lack grows into an unresolved question; marks bind to a word and a wire", () => {
    const journey = withBoundMarks(
      withUnresolvedQuestion(
        withRejection(withTentativeOnShelf(withDistinction(mappedSubject()))),
      ),
    );
    const files = write(journey);
    const reopened = reopen(files);

    const question = reopened.refs.find(
      (ref) => ref.name === "why does rain miss the soil?",
    )!;
    // Grown in place: an ordinary question-word at the spot, still unresolved.
    expect(question.slug).toBe("why-does-rain-miss-the-soil");
    expect(question.x).toBe(560);
    expect(question.y).toBe(470);
    expect(hasMark(reopened.marks, "open", word(question.slug!))).toBe(true);
    // The mark moved; the bare spot is not a second mark.
    expect(hasMark(reopened.marks, "open", spot(560, 470))).toBe(false);

    // All three target forms are live: the grown word, the bound word, the
    // bound wire. The two ring drops prove the word and wire bindings.
    expect(hasMark(reopened.marks, "open", word("mulch"))).toBe(true);
    expect(hasMark(reopened.marks, "open", word("soil"))).toBe(true);
    expect(hasMark(reopened.marks, "open", wire("rain", "tap-water", "vs"))).toBe(
      true,
    );
    expect(reopened.marks).toHaveLength(4);
    expect(orphans(reopened)).toEqual([]);

    expect(files["map/marks.jsonl"]).toBe(
      [
        '{"kind":"open","on":"mulch"}',
        '{"kind":"open","on":"why-does-rain-miss-the-soil"}',
        '{"kind":"open","on":"soil"}',
        '{"from":"rain","kind":"open","to":"tap-water","word":"vs"}',
        "",
      ].join("\n"),
    );
  });

  test("quit, reopen: every file reads exactly as left, nothing counted or queued", () => {
    const files = write(fullJourney());
    const reopened = reopen(files); // every file's bytes are asserted in reopen

    // The shelf reads by position alone: deferred (marked) vs rejected (not).
    const shelved = reopened.refs
      .filter((ref) => isShelved(ref.x, WORD_WIDTH, FOLD))
      .map((ref) => ref.slug)
      .sort();
    expect(shelved).toEqual(["mulch", "sprinkler"]);
    expect(hasMark(reopened.marks, "open", word("mulch"))).toBe(true);
    expect(hasMark(reopened.marks, "open", word("sprinkler"))).toBe(false);
    // The question is still unresolved, and the distinction is still two
    // words and a cut word — the map reads exactly as it was left.
    expect(
      hasMark(reopened.marks, "open", word("why-does-rain-miss-the-soil")),
    ).toBe(true);
    expect(reopened.marks).toHaveLength(4);
    expect(reopened.distances.map((d) => d.word)).toEqual(["vs"]);

    // No counts, queues, backlog or shelf copy: the files a map already had,
    // plus one per coined word.
    expect(Object.keys(files).sort()).toEqual([
      "map/distances.jsonl",
      "map/marks.jsonl",
      "map/references/mulch.md",
      "map/references/rain.md",
      "map/references/soil.md",
      "map/references/sprinkler.md",
      "map/references/tap-water.md",
      "map/references/why-does-rain-miss-the-soil.md",
      "workspace.yml",
    ]);
    for (const path of Object.keys(files)) {
      expect(path).not.toMatch(/count|queue|backlog|score|shelf/i);
    }
    // A reference's file never grows a shelf field; only name/x/y and prose.
    for (const ref of reopened.refs) {
      expect(ref.extra).toEqual({});
      expect(serializeReference(ref)).not.toMatch(/shelf|deferred|rejected/);
    }
    // The workspace marker carries only the format key and the fold.
    expect(shelfXOf(parseYamlFields(files["workspace.yml"]))).toBe(FOLD);
    expect(Object.keys(parseYamlFields(files["workspace.yml"])).sort()).toEqual([
      "format",
      "shelf_x",
    ]);
  });

  test("revisit the set-aside possibility, revisit the rejected one, settle the question", () => {
    const opened = reopen(write(fullJourney()));

    // Bring the set-aside alternative back: a plain move, still tentative.
    let refs = opened.refs.map((ref) =>
      ref.slug === "mulch" ? { ...ref, x: 700 } : ref,
    );
    // The rejected possibility comes back into play settled — and may be
    // marked again (a rejected word is a kept word, not a tombstone).
    refs = refs.map((ref) =>
      ref.slug === "sprinkler" ? { ...ref, x: 880 } : ref,
    );
    let marks: readonly Mark[] = withMark(opened.marks, open(word("sprinkler")));
    // Settle the question: withdraw its mark; the question-word itself stays.
    marks = withoutMark(marks, "open", word("why-does-rain-miss-the-soil"));

    const after = reopen(write({ ...opened, refs, marks }));

    // Nothing was deleted by revisiting or settling: six words remain.
    expect(after.refs).toHaveLength(6);
    expect(after.refs.filter((ref) => isShelved(ref.x, WORD_WIDTH, FOLD))).toEqual([]);
    expect(hasMark(after.marks, "open", word("mulch"))).toBe(true);
    expect(hasMark(after.marks, "open", word("sprinkler"))).toBe(true);
    expect(
      hasMark(after.marks, "open", word("why-does-rain-miss-the-soil")),
    ).toBe(false);
    expect(after.marks).toHaveLength(4);
    expect(
      after.refs.find((ref) => ref.name === "why does rain miss the soil?"),
    ).toBeDefined();
    expect(orphans(after)).toEqual([]);
  });

  test("an accident — a word deleted by hand — leaves an orphan surfaced and preserved", () => {
    const files = write(fullJourney());
    const soilLine = serializeMarkLine(open(word("soil")));

    // The genuine accident ADR-0009 says never to guess away: a reference
    // file deleted outside the app's atomic remove, leaving its mark behind.
    delete files["map/references/soil.md"];
    const reopened = reopen(files);

    const orphaned = orphans(reopened);
    expect(orphaned.map((mark) => mark.target)).toEqual([word("soil")]);
    const before = serializeMarks(reopened.marks, reopened.malformedMarks);
    expect(before).toContain(soilLine);

    // An unrelated save (a new cast) keeps the orphan line byte-for-byte and
    // adds no second orphan: only the hand-edit accident is exposed.
    const unrelated = withMark(reopened.marks, open(word("rain")));
    const after = serializeMarks(unrelated, reopened.malformedMarks);
    expect(after).toContain(soilLine);
    expect(parseMarks(after).malformed).toEqual([]);
    expect(orphans({ ...reopened, marks: unrelated })).toHaveLength(1);

    // A line the app cannot read is preserved verbatim too — never repaired.
    const handEdited = `${after}{oops\n{not a mark\n`;
    const parsed = parseMarks(handEdited);
    expect(parsed.malformed).toEqual(["{oops", "{not a mark"]);
    expect(serializeMarks(parsed.marks, parsed.malformed)).toContain(
      "{oops\n{not a mark\n",
    );
  });
});

describe("the workspace marker predates and tolerates the shelf", () => {
  test("a workspace.yml without shelf_x — or with garbage — opens on the default fold", () => {
    // The pre-shelf scaffold (story 3's read path): the key is simply absent.
    const older = '# Attentioneer workspace\nformat: "attentioneer-workspace/1"\n';
    expect(parseYamlFields(older).shelf_x).toBeUndefined();
    expect(shelfXOf(parseYamlFields(older))).toBe(DEFAULT_SHELF_X);

    // Empty and unreadable values fall back too, so an older or hand-edited
    // workspace never fails to open.
    expect(shelfXOf(parseYamlFields('format: "x"\nshelf_x:\n'))).toBe(
      DEFAULT_SHELF_X,
    );
    expect(shelfXOf(parseYamlFields('format: "x"\nshelf_x: ""\n'))).toBe(
      DEFAULT_SHELF_X,
    );
    expect(shelfXOf(parseYamlFields('format: "x"\nshelf_x: wide\n'))).toBe(
      DEFAULT_SHELF_X,
    );
    expect(shelfXOf(parseYamlFields('format: "x"\nshelf_x: NaN\n'))).toBe(
      DEFAULT_SHELF_X,
    );

    // A real value is still the fold, and the scaffold writes the default.
    expect(shelfXOf(parseYamlFields('format: "x"\nshelf_x: 900\n'))).toBe(900);
    expect(shelfXOf(parseYamlFields(workspaceYml()))).toBe(DEFAULT_SHELF_X);

    // The lifecycle's `readShelfX` wraps this parser in the Tauri fs bridge and
    // falls back on an unreadable file; that bridge half is the human/app pass,
    // not a record-level assertion (no fs or Tauri here).
  });
});
