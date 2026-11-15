import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { canonicalJson } from "../src/lib/serialize";
import {
  applyScenarioStep,
  dropLinkPinsInScenarioFolder,
  dropLoopPinsInScenarioFolder,
  dropScenarioFolderTouching,
  fanOutLinkRemove,
  fanOutLoopRemove,
  fanOutLoopRename,
  renameLoopInScenarioFolder,
  rewriteScenarioFolderForWord,
  type ScenarioFolderBytes,
} from "../src/map/patches";

/**
 * Epic 8 story 2's lifecycle fan-out (ADR-0021 decision 3), automated: the
 * atomic batches reach EVERY branch folder. A rename rewrites a variant's
 * slugs and its PIN TARGETS; a remove drops the touching lines and pins. The
 * free function here is per-folder and pure; the applier is the one that walks
 * the folders, and the batch bodies are read from the source the app runs.
 *
 * Byte-faithfulness survives the fan-out: a folder the step does not touch
 * keeps its exact bytes (no canonicalization repair), a file nothing names is
 * byte-identical inside a folder that something else did change, and a
 * folder's malformed lines ride along with the lines the app rewrites.
 */

const parser = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

/** The whole folder, in the batch's family order, all nullable. */
function folder(
  overrides: Partial<ScenarioFolderBytes> = {},
): ScenarioFolderBytes {
  return { model: null, links: null, quantities: null, pins: null, ...overrides };
}

const RENAME = {
  model: '{"words": ["rain","soil"]}\n',
  links:
    '{"from":"rain","sign":"+","to":"soil"}\n{"from":"air","sign":"-","to":"rain"}\n{oops\n',
  quantities:
    '{"amount":3,"from":"rain","to":"soil"}\n{"amount":4,"on":"rain"}\n',
  pins:
    '{"on":"rain","text":"it gathers"}\n{"from":"rain","text":"the pair","to":"soil"}\n{"on":"soil","text":"it holds"}\n',
};

describe("a rename reaches every variant's slugs and pin targets", () => {
  const before = folder(RENAME);
  const after = rewriteScenarioFolderForWord(before, "rain", "storm");

  test("the playing set's member follows, canonically", () => {
    // A rewritten file is re-serialized by the app (sorted keys, the canonical
    // member order): the branch's hand-written spelling is the COPY's business
    // until something touches it.
    expect(after.model).toBe(canonicalJson({ words: ["soil", "storm"] }));
  });

  test("both link lines follow; the sign and the malformed line do not move", () => {
    expect(after.links).toBe(
      '{"from":"storm","sign":"+","to":"soil"}\n{"from":"air","sign":"-","to":"storm"}\n{oops\n',
    );
  });

  test("a stock line and both ends of a flow follow; the amounts do not", () => {
    expect(after.quantities).toBe(
      '{"amount":3,"from":"storm","to":"soil"}\n{"amount":4,"on":"storm"}\n',
    );
  });

  test("the pins' targets follow, their texts verbatim", () => {
    expect(after.pins).toBe(
      '{"on":"storm","text":"it gathers"}\n{"from":"storm","text":"the pair","to":"soil"}\n{"on":"soil","text":"it holds"}\n',
    );
  });

  test("renaming to the same slug is the folder itself", () => {
    expect(rewriteScenarioFolderForWord(before, "rain", "rain")).toBe(before);
  });
});

describe("a folder the step does not touch keeps its exact bytes", () => {
  test("nothing names the word: every field is byte-identical", () => {
    const untouched = folder({
      model: '{ "words": [ "mulch" ] }',
      links: '{ "from": "mulch", "sign": "-", "to": "soil" }',
      quantities: '{"amount": 7.0, "on": "mulch"}',
      pins: '{ "on": "mulch", "text": "kept" }',
    });
    const after = rewriteScenarioFolderForWord(untouched, "rain", "storm");
    // The applier's one skip test is identity: nothing changed, nothing written.
    expect(after).toBe(untouched);
    expect(after.model).toBe(untouched.model);
    expect(after.links).toBe(untouched.links);
    expect(after.quantities).toBe(untouched.quantities);
    expect(after.pins).toBe(untouched.pins);
  });

  test("a file nothing names is byte-identical inside a folder that did change", () => {
    const mixed = folder({
      model: '{"words":["rain"]}\n',
      // A hand-written quantities file with no amount key and odd spacing.
      quantities: '{ "on": "soil" }',
      pins: '{ "on": "soil", "text": "it holds" }',
    });
    const after = rewriteScenarioFolderForWord(mixed, "rain", "storm");
    expect(after.quantities).toBe(mixed.quantities);
    expect(after.pins).toBe(mixed.pins);
    expect(after.model).toBe(canonicalJson({ words: ["storm"] }));
  });

  test("an unreadable model.json is preserved exactly, never repaired", () => {
    const broken = folder({ model: '{"words": [' });
    expect(rewriteScenarioFolderForWord(broken, "rain", "storm").model).toBe(
      '{"words": [',
    );
  });

  test("an absent file stays absent through every step", () => {
    const bare = folder();
    const after = rewriteScenarioFolderForWord(bare, "rain", "storm");
    expect(after).toEqual(bare);
    expect(dropScenarioFolderTouching(bare, "rain")).toEqual(bare);
  });
});

describe("a remove drops the touching lines — die-with-target everywhere", () => {
  const before = folder({
    ...RENAME,
    pins:
      '{"on":"rain","text":"it gathers"}\n{"from":"soil","text":"the reverse","to":"rain"}\n{"text":"a spot","x":1,"y":2}\n',
  });
  const after = dropScenarioFolderTouching(before, "rain");

  test("the member, the link lines and the quantity lines go", () => {
    expect(after.model).toBe(canonicalJson({ words: ["soil"] }));
    expect(after.links).toBe("{oops\n");
    // An emptied document is the canonical empty JSONL, not a zero-byte file.
    expect(after.quantities).toBe("\n");
  });

  test("the word's pins go; the bare spot's stays", () => {
    expect(after.pins).toBe('{"text":"a spot","x":1,"y":2}\n');
  });

  test("a word nothing in the folder names changes nothing", () => {
    const other = folder(RENAME);
    expect(dropScenarioFolderTouching(other, "elsewhere")).toBe(other);
  });
});

describe("the quiet loop and link moves reach the pins only", () => {
  const before = folder({
    ...RENAME,
    pins:
      '{"loop":"weather","text":"it repeats"}\n{"from":"rain","text":"the pair","to":"soil"}\n{"on":"rain","text":"it gathers"}\n',
  });

  test("a loop rename rewrites the loop target and nothing else", () => {
    const after = renameLoopInScenarioFolder(before, "weather", "climate");
    expect(after.pins).toBe(
      '{"loop":"climate","text":"it repeats"}\n{"from":"rain","text":"the pair","to":"soil"}\n{"on":"rain","text":"it gathers"}\n',
    );
    expect(after.model).toBe(before.model);
    expect(after.links).toBe(before.links);
    expect(after.quantities).toBe(before.quantities);
  });

  test("a folder whose pins do not name the loop comes back unchanged", () => {
    const untouched = folder({ pins: '{"on":"rain","text":"it gathers"}\n' });
    expect(renameLoopInScenarioFolder(untouched, "weather", "climate")).toBe(
      untouched,
    );
    expect(dropLoopPinsInScenarioFolder(untouched, ["weather"])).toBe(untouched);
    expect(dropLinkPinsInScenarioFolder(untouched, "rain", "soil")).toBe(
      untouched,
    );
  });

  test("a loop remove drops its pins", () => {
    const after = dropLoopPinsInScenarioFolder(before, ["weather"]);
    expect(after.pins).toBe(
      '{"from":"rain","text":"the pair","to":"soil"}\n{"on":"rain","text":"it gathers"}\n',
    );
    // No loops removed is a quiet no-op.
    expect(dropLoopPinsInScenarioFolder(before, [])).toBe(before);
  });

  test("a link remove drops the pins on that pair, never the reverse", () => {
    const withReverse = folder({
      pins:
        '{"from":"rain","text":"the pair","to":"soil"}\n{"from":"soil","text":"the reverse","to":"rain"}\n',
    });
    const after = dropLinkPinsInScenarioFolder(withReverse, "rain", "soil");
    expect(after.pins).toBe('{"from":"soil","text":"the reverse","to":"rain"}\n');
  });
});

describe("the fan-out walks every folder", () => {
  const patchesSource = parser("../src/map/patches.ts");
  const useMapSource = parser("../src/canvas/useMap.ts");

  function functionBody(text: string, name: string): string {
    const start = text.indexOf("async function " + name);
    expect(start).toBeGreaterThan(-1);
    const end = text.indexOf("\n}", start);
    return text.slice(start, end);
  }

  test("the applier lists the branches, reads four files and writes only changes", () => {
    const body = functionBody(patchesSource, "applyScenarioStep");
    expect(body).toContain("listScenarios(");
    expect(body).toContain("readTextFile(modelPath(");
    expect(body).toContain("readTextFile(linksPath(");
    expect(body).toContain("readTextFile(quantitiesPath(");
    expect(body).toContain("readTextFile(pinsPath(");
    expect(body).toContain("step(folder)");
    expect(body.match(/writeChangedBytes\(/g)?.length).toBe(4);
    // The canonical writer would repair a branch's bytes: it is never used here.
    expect(body).not.toContain("writeMachineFile");
  });

  test("a changed file is the only file written", () => {
    const body = functionBody(patchesSource, "writeChangedBytes");
    expect(body).toContain("after === before");
    expect(body).toContain("return");
    expect(body).toContain("writeTextFile(");
  });

  test("the batch states the order, and the branch step sits before the old file", () => {
    expect(patchesSource).toMatch(
      /membership\n \* -> every scenario folder -> the old file/,
    );
    for (const name of ["renameReference", "removeReference"]) {
      const body = functionBody(patchesSource, name);
      expect(body).toContain("applyScenarioStep(workspacePath");
      expect(body.indexOf("applyScenarioStep(workspacePath")).toBeGreaterThan(
        body.indexOf("saveModel("),
      );
      expect(body.indexOf("applyScenarioStep(workspacePath")).toBeLessThan(
        body.indexOf("removeFile(referencePath"),
      );
    }
    // A rename rewrites; a remove drops.
    expect(functionBody(patchesSource, "renameReference")).toContain(
      "rewriteScenarioFolderForWord(",
    );
    expect(functionBody(patchesSource, "removeReference")).toContain(
      "dropScenarioFolderTouching(",
    );
  });

  test("the quiet moves call their fan-out, not their own folder walk", () => {
    for (const name of ["fanOutLoopRename", "fanOutLoopRemove", "fanOutLinkRemove"]) {
      expect(functionBody(patchesSource, name)).toContain("applyScenarioStep(");
    }
    expect(callbackBody(useMapSource, "renameLoop")).toContain(
      "fanOutLoopRename(",
    );
    expect(callbackBody(useMapSource, "removeLoop")).toContain(
      "fanOutLoopRemove(",
    );
    expect(callbackBody(useMapSource, "removeLink")).toContain(
      "fanOutLinkRemove(",
    );
  });
});

function callbackBody(source: string, name: string): string {
  const start = source.indexOf("const " + name + " = useCallback(");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n  );", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}
