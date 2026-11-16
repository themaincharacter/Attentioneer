import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Epic 12 story 1 — the head's DECODE STATUS and TYPED refusals, automated.
 *
 * bun cannot run Rust, so the behavioural half lives in `cargo test`
 * (`head.rs` and `paths.rs`); this file pins the SHAPE the two sides share: the
 * decode vocabulary, the four typed refusal codes, the absence of a path in a
 * refusal, and the corrected "stored nowhere" doc (the PRISM stores the log).
 */

const APP = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP, rel), "utf8");
}

const HEAD_CODES = ["not-text", "cannot-reach", "escaped", "io"];

describe("the decode status is said, not silent", () => {
  test("the Rust read carries clean / with-replacement", () => {
    const rust = source("src-tauri/src/head.rs");
    expect(rust).toContain("pub enum DecodeStatus");
    expect(rust).toContain("Clean,");
    expect(rust).toContain("WithReplacement,");
    expect(rust).toContain("#[serde(rename_all = \"kebab-case\")]");
    // The lossy decode is still the decoder, now FLAGGED first.
    expect(rust).toContain("std::str::from_utf8(slice)");
    expect(rust).toContain("String::from_utf8_lossy(slice)");
    expect(rust).toContain("pub decode: DecodeStatus");
    // Absent and zero-bound reads decoded nothing, so they say clean.
    expect(rust).toContain("decode: DecodeStatus::Clean,");
    expect(rust).toContain("decode,");
  });

  test("the frontend's TextHead carries the same vocabulary", () => {
    const fs = source("src/lib/fs.ts");
    expect(fs).toContain(
      'export type DecodeStatus = "clean" | "with-replacement";',
    );
    expect(fs).toContain("decode: DecodeStatus;");
    expect(fs).toContain("invoke<TextHead>(\"read_text_head\"");
  });

  test("the PRISM's read-head Change logs the decode status", () => {
    const prisms = source("src/map/prisms.ts");
    expect(prisms).toContain("decode: DecodeStatus | null");
    expect(prisms).toContain('["clean", "with-replacement"]');
  });
});

describe("refusals are typed data, never a sentence with the path", () => {
  test("the four codes exist on both sides of the bridge", () => {
    const fs = source("src/lib/fs.ts");
    for (const code of HEAD_CODES) expect(fs).toContain(`"${code}"`);
    const rust = source("src-tauri/src/head.rs");
    expect(rust).toContain("pub enum RefusalCode");
    expect(rust).toContain("NotText,");
    expect(rust).toContain("CannotReach,");
    expect(rust).toContain("Escaped,");
    expect(rust).toContain("Io,");
    // One typed struct, a code and an at-most-OS-words detail.
    expect(rust).toContain("pub struct HeadRefusal");
    expect(rust).toContain("pub code: RefusalCode");
    expect(rust).toContain("pub detail: Option<String>");
    expect(rust).toContain("pub fn escaped()");
    // The cargo tests prove each code (see `cargo test`).
    expect(rust).toContain("fn escaped_is_the_boundary_layers_code_in_the_same_vocabulary()");
    expect(rust).toContain("fn the_refusal_codes_serialize_as_the_frontends_kebab_case()");
  });

  test("no refusal formats the path into the error", () => {
    const rust = source("src-tauri/src/head.rs");
    // The old free strings embedded the path in the refusal.
    expect(rust).not.toContain('format!("read {}: {}", path');
    expect(rust).not.toContain('format!("not a regular file: {}", path');
    expect(rust).not.toContain('format!("not a text file: {}", path');
    // What the refusal may carry: the OS's own words and the fixed reasons.
    expect(rust).toContain('"not a regular file"');
    expect(rust).toContain('"not a text file"');
    expect(rust).toContain("e.to_string()");
    expect(rust).toContain("NEVER carries the path");
  });

  test("the bridge command answers with the typed refusal", () => {
    const bridge = source("src-tauri/src/lib.rs");
    expect(bridge).toContain(
      "-> Result<head::TextHead, head::HeadRefusal>",
    );
    expect(bridge).not.toContain("Result<head::TextHead, String>");
  });
});

describe("the 'stored nowhere' doc is corrected: the PRISM stores the log", () => {
  test("the head's module doc names the PRISM and the corrected claim", () => {
    const rust = source("src-tauri/src/head.rs");
    expect(rust).toContain("THE HEAD IS A TRANSIENT; THE LOG IS THE PRISM");
    expect(rust).toContain("CORRECTED");
    expect(rust).toContain("map/prisms.jsonl");
    expect(rust).toContain("head's BYTES");
    expect(rust).toContain("the log is structural facts");
    // The old sentence is gone (the correction replaces it, not re-states it).
    expect(rust).not.toContain(
      "Every field is display data; nothing here is stored anywhere",
    );
  });
});
