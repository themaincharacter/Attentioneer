import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import {
  dirname,
  join,
  relative as relativePath,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Epic 13 story 1 — the pull module's named no-ambient scans, automated and
 * SCOPED (ADR-0030 decisions 4 and 6; the check's PORT legs).
 *
 * The pull must never fire unasked: the reader has no door, no timer, no
 * subscription and no render path, and it is imported by nothing but the
 * pull-ask handler (story 2's; it does not exist yet, so the allowlist is
 * empty and THIS test is what keeps it that way). The module carries no
 * surface vocabulary (no badge, dot, count or cue) and no verdict vocabulary
 * (no fail, wrong, differ or contradict): the wording reports, and what speaks
 * is the record. The veil seam is asserted on the TYPES: the reader never
 * imports the veil record, so the veil's prose is outside its reach — not
 * hidden by a filter, absent from its shape.
 *
 * The rest is the read-only rule at the source level: no writer, no bridge, no
 * storage, no path — the pull writes NOTHING (ADR-0030's amendment), and this
 * is the module that would have to hold a writer for it to write at all.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(APP, "src");
const PULL = join(SRC, "pull");
const READER = "pull/reader.ts";
const PROJECTION = "pull/projection.ts";

function source(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

/** The source without its comment blocks and line comments. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The code without its import statements (import paths are not data). */
function bodyOnly(text: string): string {
  return codeOnly(text).replace(/import[\s\S]*?from\s+"[^"]+";/g, "");
}

/** Every .ts/.tsx file under src/, as posix paths relative to src/. */
function sourceFiles(dir: string = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(relativePath(SRC, full).split("\\").join("/"));
    }
  }
  return out;
}

/** Every module specifier a source file imports from. */
function specifiersOf(text: string): string[] {
  return [...text.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
}

/** Does this source's import of `spec` resolve to the src-relative `target`? */
function imports(file: string, spec: string, target: string): boolean {
  if (!spec.startsWith(".")) return false;
  const resolved = relativePath(
    SRC,
    resolve(SRC, dirname(file), spec),
  )
    .split("\\")
    .join("/");
  return resolved === target;
}

function importersOfReader(): string[] {
  return sourceFiles().filter(
    (file) =>
      file !== READER &&
      specifiersOf(source(file)).some((spec) =>
        imports(file, spec, "pull/reader"),
      ),
  );
}

describe("the pull module sits outside every ambient path", () => {
  test("the reader is imported only by the pull-ask handler (which does not exist yet)", () => {
    // The scan can SEE an import: the reader's own "./projection" resolves.
    expect(imports(READER, "./projection", "pull/projection")).toBe(true);
    expect(imports(READER, "./projection", "pull/reader")).toBe(false);
    expect(imports("App.tsx", "./pull/reader", "pull/reader")).toBe(true);
    // Story 2 adds the one handler ("pull/ask.ts") to this allowlist — and
    // nothing else may ever join it.
    const HANDLER_ALLOWLIST: string[] = [];
    expect(importersOfReader()).toEqual(HANDLER_ALLOWLIST);
  });

  test("the projection is imported only by the reader (and story 2's handler)", () => {
    const importers = sourceFiles().filter(
      (file) =>
        file !== PROJECTION &&
        specifiersOf(source(file)).some((spec) =>
          imports(file, spec, "pull/projection"),
        ),
    );
    // Type-only at the reader, and nowhere else: no render path holds the
    // veil's projection either.
    expect(importers).toEqual([READER]);
  });

  test("the reader's imports are exactly the records it walks and the projection's type", () => {
    expect(new Set(specifiersOf(source(READER)))).toEqual(
      new Set([
        "../lib/serialize",
        "../map/assumptions",
        "../map/marks",
        "../map/pointers",
        "../map/quantities",
        "../scenarios/pins",
        "./projection",
      ]),
    );
    const specs = specifiersOf(source(READER));
    for (const outsider of [
      "../map/veils",
      "../lib/fs",
      "../ghost/packet",
      "../ghost/snapshot",
    ]) {
      expect(specs).not.toContain(outsider);
    }
  });

  test("the pull module is not a render path: no components, no effects, no timers", () => {
    const RENDER_TOKENS =
      /\b(useEffect|useState|useMemo|useCallback|useRef|setInterval|setTimeout|addEventListener|subscribe|requestAnimationFrame|MutationObserver|ResizeObserver|createRoot|render|mount|componentWill|componentDid|onClick|dispatchEvent)\b/;
    for (const file of [READER, PROJECTION]) {
      expect(bodyOnly(source(file))).not.toMatch(RENDER_TOKENS);
      expect(source(file)).not.toMatch(/react|\.tsx/);
    }
    // The module is two plain .ts files — there is no component to mount.
    expect(readdirSync(PULL).sort()).toEqual(["projection.ts", "reader.ts"]);
  });

  test("no door, no clock, no ambient input: nothing can fire the pull", () => {
    const AMBIENT =
      /\b(window|document|globalThis|localStorage|sessionStorage|indexedDB|navigator|clipboard|fetch|Event|CustomEvent|EventTarget|Date|Timer)\b/;
    for (const file of [READER, PROJECTION]) {
      expect(bodyOnly(source(file))).not.toMatch(AMBIENT);
    }
  });
});

describe("the pull module's vocabulary is the records' own", () => {
  test("no badge, dot, count or cue strings — nothing announces a pull", () => {
    const SURFACE = /\b(badge|dot|count|cue)\w*/i;
    for (const file of [READER, PROJECTION]) {
      expect(bodyOnly(source(file))).not.toMatch(SURFACE);
    }
    // The anti-pattern's own words are no part of this module either.
    const ANTI_PATTERN = /\b(score|streak|meter|nudge|glow|remind)\w*/i;
    for (const file of [READER, PROJECTION]) {
      expect(bodyOnly(source(file))).not.toMatch(ANTI_PATTERN);
    }
  });

  test("no fail, wrong, differ or contradict strings — the tool names no verdict", () => {
    const VERDICT = /\b(fail|wrong|differ|contradict)\w*/i;
    for (const file of [READER, PROJECTION]) {
      expect(bodyOnly(source(file))).not.toMatch(VERDICT);
    }
  });

  test("the drop-rule sentence is a rule, never a verdict", () => {
    // The sentence the reader attaches to a dangling pin has no verdict words
    // and no directive voice; it says what standing means and stops there.
    const READER_TEXT = source(READER);
    const SENTENCE = /DANGLING_PIN_NOTE =\s*\n?\s*"([^"]+)"/.exec(READER_TEXT);
    expect(SENTENCE).not.toBeNull();
    const sentence = (SENTENCE as RegExpExecArray)[1];
    expect(sentence).not.toMatch(/\b(fail|wrong|differ|contradict)\w*/i);
    expect(sentence).not.toMatch(/(^|\W)(you|should|must|ought|consider|try)(\W|$)/i);
  });
});

describe("the veil seam is structural (source-scanned)", () => {
  test("the reader never imports the veil record and never names its prose", () => {
    const reader = source(READER);
    expect(specifiersOf(reader)).not.toContain("../map/veils");
    // The prose's word and the record's type are not in the reader AT ALL —
    // the reader holds the projection's shape, not the record.
    expect(reader).not.toMatch(/\breason\b/i);
    expect(reader).not.toMatch(/\bVeil\b/);
    expect(reader).toContain("readonly VeilProjection[]");
  });

  test("the projection drops the prose in code and never reads the cover", () => {
    const code = codeOnly(source(PROJECTION));
    expect(code).not.toMatch(/reason/i);
    expect(new Set(specifiersOf(source(PROJECTION)))).toEqual(
      new Set(["../map/veils"]),
    );
    const COVER_RULE =
      /coveredWordSlugs|veilsCoveringWord|topVeilOf|veilCoversPoint|centreOfWord|PlacedWord/;
    for (const file of [READER, PROJECTION]) {
      expect(source(file)).not.toMatch(COVER_RULE);
    }
  });

  test("the projection's shape has three fields and no other", () => {
    const code = codeOnly(source(PROJECTION));
    expect(code).toContain("area:");
    expect(code).toContain("name:");
    expect(code).toContain("location:");
    expect(code).not.toMatch(/\breason:/);
    expect(code).not.toMatch(/\bextra:/);
  });
});

describe("the pull writes nothing (source level)", () => {
  test("no writer, no bridge, no storage in the pull module", () => {
    const WRITERS =
      /\b(writeTextFile|writeFile|writeFileSync|appendFile|appendFileSync|removeFile|renameFile|createDirAll|saveMarks|saveAssumptions|saveQuantities|savePointers|saveVeils|savePins|invoke|localStorage|sessionStorage|indexedDB)\b/;
    for (const file of [READER, PROJECTION]) {
      const body = bodyOnly(source(file));
      expect(body).not.toMatch(WRITERS);
      expect(body).not.toMatch(/\bworkspacePath\b|\bfs\b/);
      expect(specifiersOf(source(file))).not.toContain("../lib/fs");
    }
  });

  test("nothing is computed: no arithmetic, no totals, no measuring", () => {
    for (const file of [READER, PROJECTION]) {
      expect(bodyOnly(source(file))).not.toMatch(
        /Math\.|\.reduce\(|\.sort\(|Number\(|parseFloat|parseInt|toFixed|\.length/,
      );
    }
  });

  test("the walk never arranges its sites: no sort, no map, no filter, no grouping table", () => {
    const body = bodyOnly(source(READER));
    expect(body).not.toMatch(
      /\.sort\(|\.map\(|\.filter\(|\.flatMap\(|\bnew Map\b|\bMap</,
    );
  });
});
