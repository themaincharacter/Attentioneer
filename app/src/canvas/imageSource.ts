import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * THE IMAGE'S ONE DOOR TO THE WEBVIEW (story 16.15): a reference to the file
 * WHERE IT ALREADY IS.
 *
 * An image reference is never copied into the workspace. The card renders the
 * person's own file through Tauri's asset protocol, so the picture on the map
 * and the picture in their folder are the same bytes, and a reopen with the
 * machine offline still shows it (the file is local; nothing is fetched).
 *
 * THE GRANT IS CONFIGURATION, NOT A CAPABILITY: `src-tauri/tauri.conf.json`
 * turns the asset protocol on and scopes it. There is no new Rust command, and
 * this module adds none — it only builds the address. The reasoning for the
 * broad scope lives in `src-tauri/asset-protocol.md` (JSON may not carry a
 * comment); the short version: a pick can land anywhere, and a narrow grant
 * would draw a broken image for a file the person was just allowed to point at.
 *
 * PROVISIONAL: the grant's width and the fallback shape below. The real
 * conversion is always the platform's own `convertFileSrc` (Windows serves the
 * protocol from `http://asset.localhost`, elsewhere from `asset://localhost`);
 * the fallback exists only where the Tauri runtime is absent (a unit test, a
 * plain browser tab), where it proves the shape without loading a byte.
 */
export function assetSrc(absolutePath: string): string {
  const internals = (
    globalThis as {
      __TAURI_INTERNALS__?: { convertFileSrc?: unknown };
    }
  ).__TAURI_INTERNALS__;
  if (internals !== undefined && typeof internals.convertFileSrc === "function") {
    return convertFileSrc(absolutePath);
  }
  return "asset://localhost/" + encodeURIComponent(absolutePath.replace(/\\/g, "/"));
}
