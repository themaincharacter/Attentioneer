import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  clipHead,
  clipLines,
  HEAD_MAX_BYTES,
  HEAD_MAX_LINES,
} from "../src/lib/headBounds";

/**
 * The head's bounds, automated (Epic 5 story 2): a glimpse is small by
 * construction. The bridge enforces the same bounds where the read happens
 * (`app/src-tauri/src/head.rs`: BufReader prefix read, byte cap, char-boundary
 * cut, regular-file guard), and this pure module owns the display side — the
 * numbers the window asks for, a defensive clip that never splits a code point,
 * and the read-only guarantee read off the Rust source.
 *
 * The guard itself is Rust's (and its own `cargo test` proves the stat-first
 * rule, the FIFO/device/directory refusals and the byte cap); bun cannot run
 * Rust, so the source assertions below pin the guard's SHAPE while the pure
 * clip pins the display's promise.
 */

const rust = readFileSync(
  new URL("../src-tauri/src/head.rs", import.meta.url),
  "utf8",
);
const bridge = readFileSync(
  new URL("../src-tauri/src/lib.rs", import.meta.url),
  "utf8",
);

describe("the glimpse bounds are the story's small numbers", () => {
  test("the window asks for a bounded number of lines and bytes", () => {
    // Provisional numbers, pinned here so a change is a deliberate act (the
    // story's check can tune them): a glimpse, not a document.
    expect(HEAD_MAX_LINES).toBe(20);
    expect(HEAD_MAX_BYTES).toBe(1600);
    expect(HEAD_MAX_LINES).toBeGreaterThan(0);
    expect(HEAD_MAX_BYTES).toBeGreaterThan(0);
  });
});

describe("the byte cap cuts UTF-8 without splitting a code point", () => {
  test("plain ascii fits or is cut exactly at the byte cap", () => {
    const exact = clipHead("abcdefghij", 100, 10);
    expect(exact).toEqual({ head: "abcdefghij", truncated: false });
    const cut = clipHead("abcdefghij", 100, 4);
    expect(cut).toEqual({ head: "abcd", truncated: true });
  });

  test("a two-byte char is kept whole or dropped whole", () => {
    // 'é' is two UTF-8 bytes: one byte of budget fits nothing complete.
    expect(clipHead("é", 100, 1)).toEqual({ head: "", truncated: true });
    expect(clipHead("éx", 100, 2)).toEqual({ head: "é", truncated: true });
    expect(clipHead("aéx", 100, 2)).toEqual({ head: "a", truncated: true });
  });

  test("a four-byte code point (a surrogate pair in JS) is never halved", () => {
    // '😀' is one code point, four UTF-8 bytes, two UTF-16 code units.
    const emoji = "😀";
    expect(clipHead(emoji + "x", 100, 4)).toEqual({ head: "😀", truncated: true });
    expect(clipHead(emoji + "x", 100, 3)).toEqual({ head: "", truncated: true });
    expect(clipHead("a" + emoji + "x", 100, 5)).toEqual({ head: "a😀", truncated: true });
    // No replacement character ever appears from a boundary cut.
    for (const bytes of [1, 2, 3, 4, 5, 6]) {
      expect(clipHead("a" + emoji + "x", 100, bytes).head).not.toContain("\uFFFD");
    }
  });

  test("an invalid-looking tail never leaks a partial sequence", () => {
    const head = clipHead("€x", 100, 2).head;
    expect(head).toBe("");
    expect(new TextEncoder().encode(head).length).toBeLessThanOrEqual(2);
  });
});

describe("the line cap cuts after the nth newline", () => {
  test("more lines than the bound are cut, with the truncated flag", () => {
    expect(clipLines("l1\nl2\nl3\n", 2)).toEqual({
      head: "l1\nl2\n",
      truncated: true,
    });
  });

  test("an exact fit is not truncated", () => {
    expect(clipLines("l1\nl2\n", 2)).toEqual({
      head: "l1\nl2\n",
      truncated: false,
    });
    expect(clipLines("one line", 1)).toEqual({
      head: "one line",
      truncated: false,
    });
  });

  test("zero lines is an empty head that says there is more", () => {
    expect(clipLines("anything\n", 0)).toEqual({ head: "", truncated: true });
    expect(clipLines("", 0)).toEqual({ head: "", truncated: false });
  });

  test("clipHead applies the line cap and the byte cap together", () => {
    const text = "aaaa\nbbbb\ncccc\n";
    // Two lines fit in 100 bytes but not in 6.
    expect(clipHead(text, 2, 100)).toEqual({
      head: "aaaa\nbbbb\n",
      truncated: true,
    });
    expect(clipHead(text, 100, 6)).toEqual({ head: "aaaa\nb", truncated: true });
  });
});

describe("the bridge's head read is guarded and read-only by construction", () => {
  test("stat first: regular files only, pseudo files refused before opening", () => {
    expect(rust).toContain("fs::metadata(path)");
    expect(rust).toContain("if !meta.is_file() || is_pseudo_path(path)");
    expect(rust).toContain("not a regular file");
    expect(rust).toContain('matches!(first, "proc" | "sys" | "dev")');
    // A missing path is an honest absence, not an IO error.
    expect(rust).toContain("ErrorKind::NotFound => return Ok(TextHead::absent())");
    // The FIFO guard is exercised by its own cargo test.
    expect(rust).toContain("fn a_fifo_is_refused_not_opened()");
    expect(rust).toContain("is_fifo()");
  });

  test("the byte cap short-circuits the read and the cut is char-safe", () => {
    // Only max_bytes + 1 is ever read, so a huge file cannot cross the bridge.
    expect(rust).toContain("saturating_add(1)");
    expect(rust).toContain(".take(budget)");
    expect(rust).toContain("fn char_boundary");
    expect(rust).toContain("String::from_utf8_lossy");
    expect(rust).toContain("truncated: byte_truncated || line_truncated");
    // The binary guard: a NUL byte is "not a text file", never rendered.
    expect(rust).toContain("raw.contains(&0)");
    expect(rust).toContain("not a text file");
  });

  test("the module has no writer at all (read-only by construction)", () => {
    // The production half only: the #[cfg(test)] fixtures do write temp files.
    const production = rust.slice(0, rust.indexOf("#[cfg(test)]"));
    expect(production).not.toContain("fs::write");
    expect(production).not.toContain("fs::remove");
    expect(production).not.toContain("fs::rename");
    expect(production).not.toContain("write_text_file");
    expect(rust).toContain("READ-ONLY");
    // The arbitrary-path reach is documented as a convention boundary.
    expect(rust).toContain("CONVENTION BOUNDARY, NOT");
    expect(rust).toContain("World B");
  });

  test("the command is registered and the frontend bridge invokes it", () => {
    expect(bridge).toContain("fn read_text_head(");
    expect(bridge).toContain("head::read(&path, max_lines, max_bytes)");
    expect(bridge).toContain("read_text_head,");
    const fs = readFileSync(new URL("../src/lib/fs.ts", import.meta.url), "utf8");
    expect(fs).toContain('invoke<TextHead>("read_text_head"');
    // Tauri's camelCase JS args map to the command's snake_case params.
    expect(fs).toContain("maxLines,");
    expect(fs).toContain("maxBytes,");
    expect(fs).toContain("maxLines: number");
    expect(fs).toContain("maxBytes: number");
  });
});
