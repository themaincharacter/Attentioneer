import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  const host = process.env.TAURI_DEV_HOST;

  return {
    plugins: [react()],

    // STORY 21.4 — THE DEV COMMAND FILE'S PATH (ADR-0038 decision 6, second half).
    // A developer names one absolute file in ATTENTIONEER_DEV_COMMANDS and the
    // DEV SERVER exposes it as `import.meta.env.ATTENTIONEER_DEV_COMMANDS`; a
    // release build does not expose the name at all, so the value is never
    // baked into a shipped bundle. The exposed value is not permission: the
    // gate (`src/dev/gate.ts`) still refuses unless the build is a developer
    // build and the path is absolute.
    envPrefix: command === "serve" ? ["VITE_", "ATTENTIONEER_"] : "VITE_",

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        // 3. tell Vite to ignore watching `src-tauri`
        ignored: ["**/src-tauri/**"],
      },
    },
  };
});
