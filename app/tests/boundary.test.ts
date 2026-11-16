import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isWithinRoot,
  joinToRoot,
  resolveWithin,
  type Canonicalize,
} from "../src/contacts/boundary";
import { READ_HEAD_OUTCOMES } from "../src/map/prisms";

/**
 * Epic 12 story 1 — the boundary layer (ADR-0029 rule 1), automated.
 *
 * The resolver is PURE: the realpath is injected. Its rules are realpath after
 * join, then a component-wise comparison with the canonical ROOT: a climb or a
 * symlink that lands outside is `escaped`; a missing target resolves as far as
 * it exists (the Rust command keeps the tail); an unanswerable canonicalization
 * is `cannot-reach`. The Rust primitive is pinned by its own cargo tests; the
 * bridge's wiring is pinned here by source scan (bun cannot run Rust).
 */

const APP = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP, rel), "utf8");
}

/** A lexical POSIX realpath: resolve "." and ".." against the root. */
export function normalizePath(path: string): string {
  const parts = path.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return "/" + out.join("/");
}

/** The canonicalizer the tests inject (the app injects the Rust command). */
const realpath: Canonicalize = async (path) => normalizePath(path);

describe("join: the authored value is appended verbatim", () => {
  test("a root without a trailing separator gains one", () => {
    expect(joinToRoot("/ws", "notes/x.md")).toBe("/ws/notes/x.md");
  });

  test("a root with a trailing separator is not doubled", () => {
    expect(joinToRoot("/ws/", "notes/x.md")).toBe("/ws/notes/x.md");
    expect(joinToRoot("C:\\ws\\", "notes/x.md")).toBe("C:\\ws\\notes/x.md");
  });

  test("an absolute-looking path stays workspace-relative (World B)", () => {
    // The form is the authored key; the value is never sniffed or re-rooted.
    expect(joinToRoot("/ws", "/etc/hosts")).toBe("/ws//etc/hosts");
  });
});

describe("containment is component-wise, never a string prefix", () => {
  test("the root contains itself and its children only", () => {
    expect(isWithinRoot("/ws", "/ws")).toBe(true);
    expect(isWithinRoot("/ws", "/ws/a/b.md")).toBe(true);
    expect(isWithinRoot("/ws", "/ws2/a.md")).toBe(false);
    expect(isWithinRoot("/ws", "/ws/../outside")).toBe(false);
    expect(isWithinRoot("/ws", "/")).toBe(false);
    expect(isWithinRoot("/ws", "/w")).toBe(false);
  });

  test("both separator spellings compare; Windows folds case", () => {
    expect(isWithinRoot("C:\\ws", "C:\\ws\\a.md")).toBe(true);
    expect(isWithinRoot("C:\\ws", "C:\\ws2\\a.md")).toBe(false);
    expect(isWithinRoot("C:\\Ws", "c:\\ws\\a.md")).toBe(true);
    expect(isWithinRoot("/ws", "/WS/a.md")).toBe(false);
  });

  test("a trailing separator changes nothing", () => {
    expect(isWithinRoot("/ws/", "/ws/a.md")).toBe(true);
    expect(isWithinRoot("/ws", "/ws/")).toBe(true);
  });
});

describe("resolveWithin: realpath after join, escapes refused", () => {
  test("a path under the root resolves to its canonical target", async () => {
    expect(await resolveWithin("/ws", "notes/x.md", realpath)).toEqual({
      outcome: "resolved",
      path: "/ws/notes/x.md",
    });
  });

  test("the root itself resolves", async () => {
    expect(await resolveWithin("/ws", ".", realpath)).toEqual({
      outcome: "resolved",
      path: "/ws",
    });
  });

  test("a '..' climb that leaves the root REFUSES as escaped", async () => {
    expect(await resolveWithin("/ws", "../outside/x.md", realpath)).toEqual({
      outcome: "escaped",
    });
    expect(
      await resolveWithin("/ws", "notes/../../outside/x.md", realpath),
    ).toEqual({ outcome: "escaped" });
  });

  test("a '..' that stays inside the root resolves", async () => {
    expect(await resolveWithin("/ws", "notes/../x.md", realpath)).toEqual({
      outcome: "resolved",
      path: "/ws/x.md",
    });
  });

  test("a symlink escape REFUSES: the canonicalized target is outside", async () => {
    const symlinked: Canonicalize = async (path) => {
      if (path === "/ws/link/x.md") return "/outside/x.md";
      return normalizePath(path);
    };
    expect(await resolveWithin("/ws", "link/x.md", symlinked)).toEqual({
      outcome: "escaped",
    });
  });

  test("a symlinked ROOT still resolves its own children", async () => {
    // The workspace was opened through a link; every target canonicalizes to
    // the real folder. Comparing against the UNCANONICAL root would escape
    // everything — so the root is canonicalized first.
    const linkedRoot: Canonicalize = async (path) => {
      if (path === "/home/k/ws-link") return "/home/k/ws";
      return normalizePath(path);
    };
    expect(
      await resolveWithin("/home/k/ws-link", "notes/x.md", linkedRoot),
    ).toEqual({ outcome: "resolved", path: "/home/k/ws/notes/x.md" });
  });

  test("a missing target resolves as far as it exists (the tail is kept)", async () => {
    const asFarAsExists: Canonicalize = async (path) =>
      normalizePath(path);
    expect(
      await resolveWithin("/ws", "new/deeper/missing.txt", asFarAsExists),
    ).toEqual({
      outcome: "resolved",
      path: "/ws/new/deeper/missing.txt",
    });
  });

  test("an absolute-looking value is resolved INSIDE the root", async () => {
    expect(await resolveWithin("/ws", "/etc/hosts", realpath)).toEqual({
      outcome: "resolved",
      path: "/ws/etc/hosts",
    });
  });

  test("a canonicalization that cannot answer is cannot-reach", async () => {
    const noRoot: Canonicalize = async () => null;
    expect(await resolveWithin("/ws", "x", noRoot)).toEqual({
      outcome: "cannot-reach",
    });
    const noTarget: Canonicalize = async (path) =>
      path === "/ws" ? "/ws" : null;
    expect(await resolveWithin("/ws", "x", noTarget)).toEqual({
      outcome: "cannot-reach",
    });
  });

  test("the resolver's escaped outcome is the PRISM's read-head vocabulary", () => {
    expect([...READ_HEAD_OUTCOMES]).toContain("escaped");
  });
});

describe("the boundary is ONE pure JS layer over an unscoped bridge", () => {
  test("the resolver imports no bridge and does no filesystem work", () => {
    const boundary = source("src/contacts/boundary.ts");
    expect(boundary).not.toContain("../lib/fs");
    expect(boundary).not.toContain("node:fs");
    expect(boundary).not.toContain("@tauri-apps");
    expect(boundary).not.toContain("invoke(");
    // Purity is the seam: the canonicalizer arrives as a parameter.
    expect(boundary).toContain("canonicalize: Canonicalize");
  });

  test("the bridge grows the one call, and the command is registered", () => {
    const fs = source("src/lib/fs.ts");
    expect(fs).toContain('invoke<string>("canonicalize_path"');
    expect(fs).toContain("export async function canonicalizePath(");
    const bridge = source("src-tauri/src/lib.rs");
    expect(bridge).toContain("fn canonicalize_path(path: String)");
    expect(bridge).toContain("paths::canonicalize(&path)");
    expect(bridge).toContain("canonicalize_path,");
    // The Rust bridge is UNSCOPED by design: the command takes no root.
    expect(bridge).not.toContain("fn canonicalize_path(path: String, root");
  });

  test("the Rust primitive walks to the deepest existing ancestor", () => {
    const paths = source("src-tauri/src/paths.rs");
    expect(paths).toContain("fs::canonicalize(&current)");
    expect(paths).toContain("ErrorKind::NotFound");
    expect(paths).toContain("current.components().next_back()");
    expect(paths).toContain("missing.iter().rev()");
    expect(paths).toContain("fn normalize(");
    // It knows no workspace root: the caller checks (ADR-0029's one layer).
    expect(paths).toContain("pub fn canonicalize(path: &str)");
    expect(paths).toContain("the CALLER compares");
  });
});
