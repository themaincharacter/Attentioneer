/**
 * THE CLIPBOARD BRIDGE (Epic 12 story 3) — the Ask's COPY door, and only it.
 *
 * A question leaves the app by copy or by OS handoff (contacts/ask.ts's two
 * transports). The copy is the webview's own clipboard API, with a quiet
 * fallback to the old selection trick for a webview that denies the async API
 * (a permission, a secure-context rule, a Linux WebKit build): a hidden
 * read-only textarea, select, `document.execCommand("copy")`, removed again.
 * False means nothing left — the caller treats that as "not a Move" and says
 * so, never as a silent no-op.
 *
 * This module is a BRIDGE, like fs.ts: it holds no state, imports no React and
 * touches no record. The contact flow receives it as an injected dep, so bun
 * asserts the flow without a clipboard.
 *
 * Provisional: the two-step implementation (the clipboard-manager plugin is
 * not added in this story; the webview API works where it works, and the
 * fallback covers the rest), and the silent failure (a copy the OS declined is
 * one honest sentence in the panel, never a retry loop).
 */

/**
 * Copy text to the system clipboard. Returns whether the copy landed; false is
 * the honest "nothing left" (the flow then appends no PRISM).
 */
export async function copyText(text: string): Promise<boolean> {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard !== undefined &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the selection fallback (the webview declined the API).
    }
  }
  return selectionCopy(text);
}

/** The old selection trick: hidden textarea, select, execCommand("copy"). */
function selectionCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  area.style.top = "0";
  let copied = false;
  try {
    document.body.appendChild(area);
    area.select();
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    area.remove();
  }
  return copied;
}
