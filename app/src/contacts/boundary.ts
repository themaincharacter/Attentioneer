/**
 * THE BOUNDARY LAYER (Epic 12 story 1, ADR-0029) — the ONE place a pointer's
 * workspace-relative `path` is resolved against the workspace root, and the
 * one place an escape is refused.
 *
 * The rule is realpath after join: the authored value is joined to the root
 * EXACTLY as written (World B: never trimmed, normalized or repaired here),
 * the result is canonicalized by the filesystem (symlinks and `..` followed),
 * and the canonical target is compared with the canonical ROOT. A target at or
 * under the root is `resolved`; a target that lands outside it — through
 * `..`, through a symlink, or through both — is `escaped`; a canonicalization
 * that cannot answer at all is `cannot-reach`. The root is canonicalized too:
 * a workspace opened through a symlink would otherwise report every path as an
 * escape.
 *
 * THIS MODULE IS PURE: it does no filesystem work and imports no bridge. The
 * canonicalizer is INJECTED (the app passes `canonicalizePath` from
 * `lib/fs.ts`, which calls the Rust `canonicalize_path` command), so the
 * resolver's rules are asserted with a fake and the real answer comes from the
 * filesystem. Purity is the seam: the boundary's arithmetic is testable without
 * a Tauri runtime.
 *
 * ONE LAYER, STATED HONESTLY (ADR-0029 rule 1): this is the v1 boundary. The
 * bridge BELOW this layer (`read_text_file`, `read_text_head`,
 * `write_text_file`) is UNSCOPED — the Rust-side guard is the named debt — so
 * this layer is where the app keeps its promise. The `at` and `url` pointer
 * forms never enter here: `at` is the authored machine-local exception
 * (ADR-0017) and `url` is not a filesystem target at all.
 *
 * Provisional: the outcome vocabulary's spelling (`resolved` / `escaped` /
 * `cannot-reach`) and the separator handling (forward slashes are the app's
 * convention; a Windows root keeps its own separator and both forms compare).
 */

/** A canonicalizer: the real path as far as the path exists, or null. */
export type Canonicalize = (path: string) => Promise<string | null>;

/** What the boundary layer answered. */
export type BoundaryResolution =
  | { outcome: "resolved"; path: string }
  | { outcome: "escaped" }
  | { outcome: "cannot-reach" };

/**
 * Join the authored value to the root with the app's one convention. The value
 * is appended verbatim: an absolute-looking `path` stays a workspace-relative
 * path (ADR-0017 — the form is the authored key, never sniffed from the
 * value), and the filesystem canonicalization is what resolves it.
 */
export function joinToRoot(root: string, value: string): string {
  if (root.endsWith("/") || root.endsWith("\\")) return root + value;
  return root + "/" + value;
}

/** A path spelled for Windows (a drive letter or a backslash separator). */
function isWindowsSpelled(path: string): boolean {
  return /^[A-Za-z]:/.test(path) || path.includes("\\");
}

/** The path's components, with either separator and no empty parts. */
function componentsOf(path: string): string[] {
  return path.split(/[\\/]+/).filter((part) => part !== "");
}

/**
 * Is the canonical target AT or UNDER the canonical root? Component-wise, so
 * `/ws` does not contain `/ws2`; both separator spellings compare; a Windows
 * root compares case-insensitively (its filesystem does), every other path
 * exactly.
 *
 * FAIL-CLOSED on an uncanonical side: a path still carrying `..` is not a
 * canonical answer, so it is never "within" — the check is only ever fed the
 * canonicalizer's output, and this keeps a future caller from turning a raw
 * path into a false permission.
 */
export function isWithinRoot(root: string, target: string): boolean {
  const rootParts = componentsOf(root);
  const targetParts = componentsOf(target);
  if (rootParts.includes("..") || targetParts.includes("..")) return false;
  if (targetParts.length < rootParts.length) return false;
  const fold = isWindowsSpelled(root) || isWindowsSpelled(target);
  for (let index = 0; index < rootParts.length; index += 1) {
    const left = rootParts[index];
    const right = targetParts[index];
    if (fold) {
      if (left.toLowerCase() !== right.toLowerCase()) return false;
    } else if (left !== right) {
      return false;
    }
  }
  return true;
}

/**
 * Resolve one pointer `path` against the workspace root, refusing escapes.
 * The root and the joined target are both canonicalized by the injected
 * function; a missing target canonicalizes as far as it exists (the app's
 * `canonicalize_path` command keeps the missing tail), so a target that does
 * not exist yet still resolves when its existing part is inside the root.
 */
export async function resolveWithin(
  root: string,
  value: string,
  canonicalize: Canonicalize,
): Promise<BoundaryResolution> {
  const canonicalRoot = await canonicalize(root);
  if (canonicalRoot === null) return { outcome: "cannot-reach" };
  const canonicalTarget = await canonicalize(joinToRoot(canonicalRoot, value));
  if (canonicalTarget === null) return { outcome: "cannot-reach" };
  if (!isWithinRoot(canonicalRoot, canonicalTarget)) {
    return { outcome: "escaped" };
  }
  return { outcome: "resolved", path: canonicalTarget };
}
