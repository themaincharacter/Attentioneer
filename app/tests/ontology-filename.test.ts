import { describe, expect, test } from "bun:test";
import {
  encodeGameFileName,
  ontologyDir,
  ontologyFilePath,
} from "../src/ontology/filename";

/**
 * The filename rule, automated (PROVISIONAL, added 2026-11-16 per ADR-0033 and
 * notes/ontology-language-games-research.md §5.3).
 *
 * The artifact's file is the game's name percent-encoded for the characters a
 * path forbids or reads ambiguously. Two claims matter: the encoding is
 * INJECTIVE (two names can never share one file), and it ROUND-TRIPS (the file
 * is the person's name, recoverable, with the frontmatter's `game` still the
 * authority).
 */

/** The test's own decoder: every %XX sequence back to its UTF-8 bytes. */
function decode(fileName: string): string {
  const bytes: number[] = [];
  let index = 0;
  while (index < fileName.length) {
    const escape = /^%([0-9A-F]{2})/.exec(fileName.slice(index));
    if (escape === null) {
      for (const byte of new TextEncoder().encode(fileName[index])) bytes.push(byte);
      index += 1;
      continue;
    }
    bytes.push(Number.parseInt(escape[1], 16));
    index += 3;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
}

describe("the name survives except where a path cannot take it", () => {
  test("an ordinary name is the file's name, untouched", () => {
    expect(encodeGameFileName("garden bed")).toBe("garden bed");
    expect(encodeGameFileName("café")).toBe("café");
    expect(encodeGameFileName("rain.2")).toBe("rain.2");
  });

  test("every forbidden or ambiguous character is percent-encoded", () => {
    expect(encodeGameFileName("a/b")).toBe("a%2Fb");
    expect(encodeGameFileName("a\\b")).toBe("a%5Cb");
    expect(encodeGameFileName("100%")).toBe("100%25");
    expect(encodeGameFileName("a:b")).toBe("a%3Ab");
    expect(encodeGameFileName("a*b")).toBe("a%2Ab");
    expect(encodeGameFileName("a?b")).toBe("a%3Fb");
    expect(encodeGameFileName('a"b')).toBe("a%22b");
    expect(encodeGameFileName("a<b")).toBe("a%3Cb");
    expect(encodeGameFileName("a>b")).toBe("a%3Eb");
    expect(encodeGameFileName("a|b")).toBe("a%7Cb");
  });

  test("a control character is escaped by its UTF-8 bytes", () => {
    expect(encodeGameFileName("a\u0001b")).toBe("a%01b");
    expect(encodeGameFileName("a\u007fb")).toBe("a%7Fb");
    expect(encodeGameFileName("a\u0085b")).toBe("a%C2%85b");
  });

  test("a trailing dot or space is escaped; an inner one is the person's", () => {
    expect(encodeGameFileName("rain.")).toBe("rain%2E");
    expect(encodeGameFileName("rain ")).toBe("rain%20");
    expect(encodeGameFileName("a. b")).toBe("a. b");
    expect(encodeGameFileName(".")).toBe("%2E");
    expect(encodeGameFileName("..")).toBe(".%2E");
  });

  test("the escapes round-trip to the exact name", () => {
    for (const name of [
      "garden bed",
      "a/b",
      "a\\b",
      "100%",
      "a:b",
      "a*b",
      "a?b",
      'a"b',
      "a<b",
      "a>b",
      "a|b",
      "a\u0001b",
      "rain.",
      "rain ",
      ".",
      "..",
      "café",
      "a. b",
      "注意：土",
    ]) {
      expect(decode(encodeGameFileName(name))).toBe(name);
    }
  });
});

describe("the encoding is injective: two names never share a file", () => {
  test("every tricky name encodes to a distinct segment", () => {
    const names = [
      "a/b",
      "a%2Fb",
      "a\\b",
      "a:b",
      "a*b",
      "a?b",
      'a"b',
      "a<b",
      "a>b",
      "a|b",
      "a%",
      "a%25",
      "rain.",
      "rain%2E",
      "rain",
      "Rain",
      "rain ",
      "rain%20",
      "..",
      ".%2E",
      ".",
      "%2E",
      "注意：土",
      "注意/土",
    ];
    const encoded = names.map(encodeGameFileName);
    expect(new Set(encoded).size).toBe(names.length);
  });

  test("the escape character itself can never be confused with an escape", () => {
    // A literal "%2F" is not the escaped slash: its per cent is escaped first.
    expect(encodeGameFileName("a%2Fb")).toBe("a%252Fb");
    expect(encodeGameFileName("a%2Fb")).not.toBe(encodeGameFileName("a/b"));
  });

  test("a percent-encoded tail cannot masquerade as a trailing-dot escape", () => {
    expect(encodeGameFileName("rain.%2E")).not.toBe(encodeGameFileName("rain."));
    expect(encodeGameFileName("rain%2E")).not.toBe(encodeGameFileName("rain."));
  });
});

describe("the artifact's place", () => {
  test("the folder is ontology/ under the workspace", () => {
    expect(ontologyDir("/maps/garden")).toBe("/maps/garden/ontology");
  });

  test("one file per game, .md, the encoded name", () => {
    expect(ontologyFilePath("/maps/garden", "garden bed")).toBe(
      "/maps/garden/ontology/garden bed.md",
    );
    expect(ontologyFilePath("/maps/garden", "rain/soil")).toBe(
      "/maps/garden/ontology/rain%2Fsoil.md",
    );
  });
});
