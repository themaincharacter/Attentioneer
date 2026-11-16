import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Epic 12 story 2 — the tally guard, automated and SCOPED.
 *
 * The series is the tally risk (ADR-0028's Bounded-movements amendment): a
 * PRISM may never become a list, a count or a summary. But words and pointers
 * ARE legitimate lists — the map's whole surface — so a blanket scan would be
 * a lie about the codebase. The scan is therefore scoped to the PRISM
 * surfaces (the read flow, its app wiring, the window and its words), and the
 * comment records WHY the scoped-away files are legitimate.
 *
 * The other leg: transients mint no PRISM. The peek and the veil's look-under
 * are read-only openings; they import no prism writer and append nothing.
 * Only the record module and the read path append; only the app's wiring mints
 * an id for a Move's line.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(APP, "src");

function source(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The body without its import statements (import paths are not data). */
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
      out.push(relative(SRC, full).split("\\").join("/"));
    }
  }
  return out;
}

/** The map's legitimate lists (scoped OUT of the PRISM tally scan). */
const SCOPED_AWAY = [
  "canvas/PointerChooser.tsx",
  "App.tsx",
  "map/pointers.ts",
  "map/marks.ts",
];

/** The PRISM surfaces the tally scan covers (and nothing else). */
const SURFACES = [
  "contacts/read.ts",
  "contacts/prismLog.ts",
  // Epic 12 story 3's flows and their two quiet panels: every surface that
  // writes, reads or shows a Move is inside the scan.
  "contacts/make.ts",
  "contacts/egress.ts",
  "contacts/ask.ts",
  "canvas/contactRules.ts",
  "canvas/AskPanel.tsx",
  "canvas/MakePanel.tsx",
  "canvas/prismRules.ts",
  "canvas/PrismWindow.tsx",
];

const PRISM_WRITERS = [
  "appendPrismLine",
  "mintPrismId",
  "savePrismExplanation",
  "rewritePrismExplanation",
];

const PRISM_READERS = ["runReadMove", "readLatestPrism", "loadLatestPrism"];

describe("no list, count or sum affordance over PRISMs (scoped)", () => {
  test("the scan is scoped to the PRISM surfaces, not the map's legal lists", () => {
    expect(SURFACES).not.toContain("canvas/PointerChooser.tsx");
    expect(SURFACES).not.toContain("App.tsx");
    expect(SURFACES).not.toContain("map/pointers.ts");
    // Words and pointers are legitimate lists: the scoped-away files list rows.
    expect(source("canvas/PointerChooser.tsx")).toContain("rows.map(");
    expect(source("App.tsx")).toContain("refs.map(");
    expect(source("map/pointers.ts")).toContain("findPointers");
    expect(source("map/marks.ts")).toContain("Mark[]");
    // The guard is not a blanket word ban: these files legitimately pick/list.
    expect(source("canvas/PointerChooser.tsx")).toContain("POINTER_PICKS");
    for (const file of SCOPED_AWAY) {
      expect(SURFACES).not.toContain(file);
    }
  });

  test("the PRISM surfaces hold no listing, counting or summing API", () => {
    const FORBIDDEN = /\b(listPrisms|countPrisms|allPrisms|sumPrisms|totalPrisms|prismCount|prismSummary|prismsBy)\b/;
    for (const file of SURFACES) {
      const code = bodyOnly(source(file));
      expect(code).not.toMatch(FORBIDDEN);
      expect(code).not.toContain(".reduce(");
      expect(code).not.toContain("prisms.length");
      expect(code).not.toContain("prisms.map");
      expect(code).not.toMatch(/Prism\[\]/);
    }
    // The window's words never see an array at all.
    for (const file of ["canvas/prismRules.ts", "canvas/PrismWindow.tsx"]) {
      const code = bodyOnly(source(file));
      expect(code).not.toContain("prisms");
    }
  });

  test("the window shows ONE Move: no next/previous, no gallery, no history", () => {
    const window = bodyOnly(source("canvas/PrismWindow.tsx"));
    const rules = bodyOnly(source("canvas/prismRules.ts"));
    for (const text of [window, rules]) {
      expect(text).not.toContain("gallery");
      expect(text).not.toContain("previous");
      expect(text).not.toContain("</select>");
      expect(text).not.toContain("nextPrism");
      expect(text).not.toContain("prism-list");
      expect(text).not.toContain("prismList");
    }
    expect(window).toContain("prism: Prism | null");
  });

  test("the app holds ONE Prism, never the series", () => {
    const app = bodyOnly(source("App.tsx"));
    expect(app).not.toContain("prisms");
    expect(app).not.toContain("setPrisms");
    expect(app).not.toMatch(/Prism\[\]/);
    // The reopen reads one by citation; nothing loads the whole log into state.
    expect(source("App.tsx")).toContain("readLatestPrism(");
  });
});

describe("transients mint no PRISM (the story 1 scan, extended)", () => {
  const TRANSIENTS = [
    "canvas/OutwardWindow.tsx",
    "canvas/VeilLookUnder.tsx",
    "canvas/outward.ts",
    "canvas/outwardRules.ts",
    "canvas/veilRules.ts",
    "canvas/prismRules.ts",
    "canvas/PrismWindow.tsx",
  ];

  test("the peek, the look-under and the window import no writer", () => {
    for (const file of TRANSIENTS) {
      const code = bodyOnly(source(file));
      for (const writer of [...PRISM_WRITERS, ...PRISM_READERS]) {
        expect({ file, writer, found: code.includes(writer) }).toEqual({
          file,
          writer,
          found: false,
        });
      }
    }
  });

  test("only the contact flows and the record module append a PRISM", () => {
    const appenders: string[] = [];
    const minters: string[] = [];
    for (const file of sourceFiles()) {
      const code = bodyOnly(source(file));
      if (code.includes("appendPrismLine(")) appenders.push(file);
      if (code.includes("mintPrismId(")) minters.push(file);
    }
    // The four contact flows (read, make, egress, ask) each append THEIR Move
    // through the record module's append door; the panels never do.
    expect(appenders.sort()).toEqual([
      "contacts/ask.ts",
      "contacts/egress.ts",
      "contacts/make.ts",
      "contacts/read.ts",
      "map/prisms.ts",
    ]);
    // The adapter only references the minter (mintId: mintPrismId); the flows
    // call the injected dep, so the record module is the one place that
    // actually mints an id.
    expect(minters.sort()).toEqual(["map/prisms.ts"]);
  });

  test("the peek is still a read-only transient (nothing is written)", () => {
    const peek = source("canvas/OutwardWindow.tsx");
    expect(peek).toContain("readTextHead(");
    expect(peek).not.toContain("writeTextFile(");
    expect(peek).not.toContain("appendPrismLine(");
    const lookUnder = source("canvas/VeilLookUnder.tsx");
    expect(lookUnder).not.toContain("writeTextFile(");
    expect(lookUnder).not.toContain("appendPrismLine(");
  });
});
