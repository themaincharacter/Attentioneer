/**
 * THE ONTOLOGY EXPORT'S FILE NAME (PROVISIONAL, added 2026-11-16 per ADR-0033
 * and notes/ontology-language-games-research.md §5.3).
 *
 * The artifact lives at `<workspace>/ontology/<encoded game name>.md` — ONE file
 * per language game. The game's name is the person's coin, so it is kept as the
 * file's name wherever a path allows it: only the characters that are FORBIDDEN
 * or AMBIGUOUS in a path are percent-encoded (uppercase hex, UTF-8 bytes), and
 * `%` itself is always encoded so every escape is unmistakable. That makes the
 * mapping INJECTIVE: two different names can never land on one file, and the
 * encoding round-trips back to the exact name.
 *
 * Encoded: `%`, `/`, `\\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`, control characters
 * (C0, DEL and the C1 range), and a TRAILING dot or space (a path's own
 * ambiguity: `rain.` and `rain` must not be one file).
 *
 * The frontmatter's `game` is authoritative — this name is a convenience for
 * the person reading the folder, never an identity (rename the game and the old
 * file is swept; the bytes it held always said which game it described).
 *
 * PROVISIONAL: a name whose encoded form exceeds the filesystem's path limit is
 * not shortened here (the family mints no suffix and the name may not be
 * summarised); and on a case-insensitive filesystem two games whose names
 * differ only in case share one file, because the record's own rule is
 * case-sensitive uniqueness. Both are reported, not silently repaired.
 */

/** Characters a path forbids or reads ambiguously; `%` is encoded because it is the escape itself. */
const FORBIDDEN = new Set(["%", "/", "\\", ":", "*", "?", '"', "<", ">", "|"]);

/** Is this code point a control character (C0, DEL, C1)? */
function isControl(code: number): boolean {
  return code <= 0x1f || code === 0x7f || (code >= 0x80 && code <= 0x9f);
}

/** One character as uppercase percent-escapes of its UTF-8 bytes. */
function escapeChar(char: string): string {
  let out = "";
  for (const byte of new TextEncoder().encode(char)) {
    out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/**
 * The game's name as one path segment: forbidden and ambiguous characters
 * percent-encoded, everything else exactly the person's spelling. Injective by
 * construction (see the module note), so two games never share a file.
 */
export function encodeGameFileName(name: string): string {
  const chars = [...name];
  let out = "";
  chars.forEach((char, index) => {
    const code = char.codePointAt(0) ?? 0;
    const trailing = index === chars.length - 1 && (char === "." || char === " ");
    out += FORBIDDEN.has(char) || isControl(code) || trailing
      ? escapeChar(char)
      : char;
  });
  return out;
}

/** The generated-export folder's name inside a workspace (ADR-0033). */
export const ONTOLOGY_DIRECTORY = "ontology";

/** The generated-export folder's path inside a workspace. */
export function ontologyDir(workspacePath: string): string {
  return workspacePath + "/" + ONTOLOGY_DIRECTORY;
}

/** One game's artifact path: the encoded name plus `.md`. */
export function ontologyFilePath(workspacePath: string, gameName: string): string {
  return ontologyDir(workspacePath) + "/" + encodeGameFileName(gameName) + ".md";
}
