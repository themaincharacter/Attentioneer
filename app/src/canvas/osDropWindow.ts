import { getCurrentWindow } from "@tauri-apps/api/window";
import { webLinkOf } from "./webLink";

/**
 * STORY 16.20 — THE ONE PLACE THE OS DROP IS HEARD.
 *
 * Tauri owns the window's drag-and-drop: the webview never sees an HTML5 drop,
 * and the window emits its own event instead. This module is the thin seam that
 * turns that event into the app's vocabulary — the dropped FILE paths, the
 * dropped LINK addresses, and the pointer's CSS-pixel point — so the app can
 * hand it to the pure rules in `osDrop.ts`. It has no opinion about cards,
 * records or refusals.
 *
 * STORY 16.34 — A LINK IS NOT A PATH. The window's native drop reports what it
 * was handed in one list, so each entry is read through the SAME `webLinkOf`
 * the paste uses: an http(s) address becomes a LINK item and everything else
 * stays a path. Nothing else about the file drop changes.
 *
 * AND THE PLATFORM MAY NOT HAND A LINK OVER AT ALL. Tauri's native drop
 * forwards file PATHS; a browser's URI list lives in the webview's drag data,
 * which the native handler normally does not pass through (the drag-drop switch
 * is all-or-nothing: turning it off would lose file paths). So a second, DOM
 * `drop` listener hears a URI when a webview does expose one — a plain browser
 * tab, or a platform whose handler forwards it — while the native path listener
 * stays exactly as it was. A link drop on a webview that never exposes the URI
 * cannot be honoured without a Rust-side handler, which this story does not
 * add; PROVISIONAL and human-confirmed in the window.
 *
 * The event's position is a PHYSICAL pixel, relative to the window; the webview
 * measures its elements in CSS pixels, so the ratio is divided out here. The
 * window's content and its webview are the same box, which is what makes the
 * point comparable with `getBoundingClientRect` — PROVISIONAL, because a
 * platform with a decorated client area could shift it.
 *
 * A plain browser tab has no Tauri runtime: the native subscription answers a
 * no-op, and only the DOM URI listener can fire. Tests and `bun run dev` never
 * need the runtime.
 */

/** A drop the OS reported, in the app's terms. */
export interface OsDrop {
  /** File paths exactly as the OS handed them, in the OS's order. */
  readonly paths: readonly string[];
  /** Web addresses the drop carried (a desktop link, a URI list). */
  readonly links: readonly string[];
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

/** Split what a drop carried into file paths and web addresses. PURE. */
export function splitDropItems(items: readonly string[]): {
  paths: string[];
  links: string[];
} {
  const paths: string[] = [];
  const links: string[] = [];
  for (const item of items) {
    const url = webLinkOf(item);
    if (url === null) paths.push(item);
    else links.push(url);
  }
  return { paths, links };
}

/** One URI's text out of a drag's data, or null (PURE). */
export function draggedLink(dt: DataTransfer | null): string | null {
  if (dt === null) return null;
  const uriList = dt.getData("text/uri-list");
  const text = uriList !== "" ? uriList : dt.getData("text/plain");
  return webLinkOf(text);
}

/**
 * Hear the window's drops until `unlisten` is called. Only a DROP is reported:
 * the enter/over/leave chatter is not a gesture the person authored, and the
 * app does not preview a file before it lands.
 */
export async function listenOsDrop(
  onDrop: (drop: OsDrop) => void,
): Promise<() => void> {
  const stops: (() => void)[] = [];

  // A webview that lets the page see a URI's drag data (a browser tab, or a
  // platform that forwards the text list). File drops are never taken here:
  // their paths are the native listener's, and this one only claims an URI.
  if (typeof document !== "undefined") {
    const onDragOver = (event: DragEvent) => {
      // The TYPES are readable during a drag even when the DATA is protected;
      // both lists may carry an address, so either one makes this a drop the
      // map wants (without it, the drop event never fires).
      const types = event.dataTransfer?.types;
      if (types === undefined) return;
      if (types.includes("text/uri-list") || types.includes("text/plain")) {
        event.preventDefault();
      }
    };
    const onDomDrop = (event: DragEvent) => {
      if (event.defaultPrevented) return;
      const url = draggedLink(event.dataTransfer);
      if (url === null) return;
      // The page must not navigate to the dropped link; the map takes it.
      event.preventDefault();
      onDrop({
        paths: [],
        links: [url],
        // A DOM drop's own coordinates are already CSS pixels (unlike the
        // native event's physical ones).
        client: { x: event.clientX, y: event.clientY },
      });
    };
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDomDrop);
    stops.push(() => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDomDrop);
    });
  }

  if (!osDropAvailable()) return () => stops.forEach((stop) => stop());

  const window = getCurrentWindow();
  const unlisten = await window.onDragDropEvent((event) => {
    const payload = event.payload;
    if (payload.type !== "drop") return;
    const devicePixelRatio =
      typeof globalThis.devicePixelRatio === "number" &&
      globalThis.devicePixelRatio > 0
        ? globalThis.devicePixelRatio
        : 1;
    const { paths, links } = splitDropItems(payload.paths);
    onDrop({
      paths,
      links,
      client: {
        x: payload.position.x / devicePixelRatio,
        y: payload.position.y / devicePixelRatio,
      },
    });
  });
  stops.push(unlisten);
  return () => stops.forEach((stop) => stop());
}
