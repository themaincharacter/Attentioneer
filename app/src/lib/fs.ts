import { invoke } from "@tauri-apps/api/core";

/**
 * Thin bridges to the Rust fs commands. Machine-file *content* is owned by
 * `serialize.ts`; this module only moves bytes and asks about paths.
 */

export async function readTextFile(path: string): Promise<string | null> {
  return await invoke<string | null>("read_text_file", { path });
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  await invoke("write_text_file", { path, content });
}

export async function createDirAll(path: string): Promise<void> {
  await invoke("create_dir_all", { path });
}

export async function pathExists(path: string): Promise<boolean> {
  return await invoke<boolean>("path_exists", { path });
}

export async function listDir(path: string): Promise<string[]> {
  return await invoke<string[]>("list_dir", { path });
}

export async function renameFile(from: string, to: string): Promise<void> {
  await invoke("rename_file", { from, to });
}

export async function removeFile(path: string): Promise<void> {
  await invoke("remove_file", { path });
}