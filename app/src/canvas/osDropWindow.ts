import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * STORY 16.20 — THE ONE PLACE THE OS DROP IS HEARD.
 *
 * Tauri owns the window's drag-and-drop: the webview never sees an HTML5 drop,
 * and the window emits its own event instead. This module is the thin seam that
 * turns that event into the app's vocabulary — a list of dropped paths and the
 * pointer's CSS-pixel point — so the app can hand it to the pure rules in
 * `osDrop.ts`. It has no opinion about cards, records or refusals.
 *
 * The event's position is a PHYSICAL pixel, relative to the window; the webview
 * measures its elements in CSS pixels, so the ratio is divided out here. The
 * window's content and its webview are the same box, which is what makes the
 * point comparable with `getBoundingClientRect` — PROVISIONAL, because a
 * platform with a decorated client area could shift it.
 *
 * A plain browser tab has no Tauri runtime: the subscription answers a no-op
 * unsubscribe, so tests and `bun run dev` never arm anything. No config change
 * is needed for the event itself: Tauri's window drag-drop is on by default.
 */

/** A drop the OS reported, in the app's terms. */
export interface OsDrop {
  /** The paths exactly as the OS handed them, in the OS's order. */
  readonly paths: readonly string[];
  /** The pointer's viewport point in CSS pixels. */
  readonly client: { readonly x: number; readonly y: number };
}

/** Is the Tauri runtime present in this webview? */
export function osDropAvailable(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
      undefined
  );
}

/**
 * Hear the window's drops until `unlisten` is called. Only a DROP is reported:
 * the enter/over/leave chatter is not a gesture the person authored, and the
 * app does not preview a file before it lands.
 */
export async function listenOsDrop(
  onDrop: (drop: OsDrop) => void,
): Promise<() => void> {
  if (!osDropAvailable()) return () => {};
  const window = getCurrentWindow();
  const unlisten = await window.onDragDropEvent((event) => {
    const payload = event.payload;
    if (payload.type !== "drop") return;
    const devicePixelRatio =
      typeof globalThis.devicePixelRatio === "number" &&
      globalThis.devicePixelRatio > 0
        ? globalThis.devicePixelRatio
        : 1;
    onDrop({
      paths: payload.paths,
      client: {
        x: payload.position.x / devicePixelRatio,
        y: payload.position.y / devicePixelRatio,
      },
    });
  });
  return unlisten;
}
