import { describe, expect, test } from "bun:test";
import { parseYamlFields, workspaceYml } from "../src/lib/serialize";
import { DEFAULT_SHELF_X } from "../src/map/shelf";
import {
  DEFAULT_LEVEL,
  levelOf,
  levelOfText,
  withLevel,
} from "../src/workspace/level";

/**
 * The level key (ADR-0016): workspace.yml's provisional `level` is the sole
 * source of the active game — absent, garbage or unreadable means concept, so
 * an older workspace opens exactly as before. The key is written canonically
 * on change, in place, without touching comments or unknown keys; reopening
 * reads it back. The fs bridge half is the human/app pass, per the repo's
 * record-level test convention.
 */

describe("the default is concept, tolerantly", () => {
  test("the scaffold, an older workspace and an empty field are concept", () => {
    expect(DEFAULT_LEVEL).toBe("concept");
    // The scaffold keeps only its two original fields; the level appears on
    // the first change, so no older workspace.yml is rewritten on open.
    expect(parseYamlFields(workspaceYml()).level).toBeUndefined();
    expect(levelOf(parseYamlFields(workspaceYml()))).toBe("concept");
    expect(levelOf({})).toBe("concept");
    expect(levelOf({ level: "" })).toBe("concept");
    expect(levelOf({ level: "  " })).toBe("concept");
  });

  test("garbage values fall back to concept rather than failing to open", () => {
    for (const value of ["stock-flow", "StockFlow", "DYNAMIC", "1", 2, -1]) {
      expect(levelOf({ level: value as unknown as string })).toBe("concept");
    }
    expect(levelOfText(null)).toBe("concept");
    expect(levelOfText("")).toBe("concept");
    expect(levelOfText("format: \"x\"\n")).toBe("concept");
  });

  test("dynamics is read quoted, unquoted, cased and padded", () => {
    expect(levelOf({ level: "dynamics" })).toBe("dynamics");
    expect(levelOf({ level: " Dynamics " })).toBe("dynamics");
    expect(levelOfText('level: "dynamics"\n')).toBe("dynamics");
    expect(levelOfText("level: dynamics\n")).toBe("dynamics");
    expect(levelOfText('level: "DYNAMICS"\n')).toBe("dynamics");
  });

  test("concept is read back too", () => {
    expect(levelOf({ level: "concept" })).toBe("concept");
    expect(levelOf({ level: "Concept" })).toBe("concept");
  });
});

describe("the level is written canonically on change", () => {
  test("the scaffold gains one quoted level line and nothing else changes", () => {
    const before = workspaceYml();
    const after = withLevel(before, "dynamics");
    expect(after).toContain('level: "dynamics"');
    // Comments, the format key and the fold survive byte-for-byte.
    expect(after.startsWith("# Attentioneer workspace")).toBe(true);
    expect(after).toContain("format: attentioneer-workspace/1");
    expect(after).toContain(`shelf_x: ${DEFAULT_SHELF_X}`);
    // Exactly one line added; LF and one trailing newline.
    expect(after.split("\n").length).toBe(before.split("\n").length + 1);
    expect(after.endsWith("\n")).toBe(true);
    expect(after.includes("\r")).toBe(false);
  });

  test("reopening reads the persisted level (the key is the sole source)", () => {
    for (const level of ["concept", "dynamics"] as const) {
      const written = withLevel(workspaceYml(), level);
      expect(levelOf(parseYamlFields(written))).toBe(level);
      expect(levelOfText(written)).toBe(level);
    }
  });

  test("rewriting is idempotent: a second change touches only the value", () => {
    const once = withLevel(workspaceYml(), "dynamics");
    expect(withLevel(once, "dynamics")).toBe(once);
    const back = withLevel(once, "concept");
    expect(back).toContain('level: "concept"');
    expect(back).not.toContain('level: "dynamics"');
    expect(withLevel(back, "concept")).toBe(back);
  });

  test("an existing line is rewritten in place, and duplicates collapse", () => {
    expect(withLevel('level: "concept"\nformat: "x"\n', "dynamics")).toBe(
      'level: "dynamics"\nformat: "x"\n',
    );
    expect(withLevel('level: "concept"\nlevel: "dynamics"\n', "concept")).toBe(
      'level: "concept"\n',
    );
  });

  test("unknown keys and commented-out lines are not fields", () => {
    expect(withLevel('format: "x"\nmy_key: 7\n', "dynamics")).toBe(
      'format: "x"\nmy_key: 7\nlevel: "dynamics"\n',
    );
    expect(withLevel("# level: dynamics\nformat: \"x\"\n", "concept")).toBe(
      '# level: dynamics\nformat: "x"\nlevel: "concept"\n',
    );
  });

  test("CRLF and BOM are normalized; missing text writes only the key", () => {
    expect(withLevel('format: "x"\r\n', "concept")).toBe(
      'format: "x"\nlevel: "concept"\n',
    );
    expect(withLevel("\uFEFFformat: \"x\"\r\n", "dynamics")).toBe(
      'format: "x"\nlevel: "dynamics"\n',
    );
    expect(withLevel("", "concept")).toBe('level: "concept"\n');
    expect(withLevel("\n\n", "concept")).toBe('level: "concept"\n');
  });
});
