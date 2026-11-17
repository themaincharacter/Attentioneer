import { invoke } from "@tauri-apps/api/core";

/**
 * WHERE THE KEY LIVES, FROM THE WINDOW'S SIDE (Epic 15 story 4).
 *
 * WHY A KEYCHAIN: the app config is an ordinary readable text file. A key is a
 * capability, not a setting, so it is kept where the OS keeps capabilities and
 * read back only at the moment one request line is built. The config never
 * holds one; this bridge is the ONLY window-side door to it.
 *
 * WHY THE STATUS IS A VALUE AND NOT A HIDDEN DETAIL: the fallback (one
 * owner-only file) exists for machines with no working keychain — this WSL box
 * is one — and a person typing a key deserves to know which of the two keeps
 * it. secretStatusWords is the one sentence both panels always show. The
 * status is asked of the store each time, never remembered to hide a change:
 * a keychain that appears or dies is stated the next time the panel opens.
 *
 * WHY THE KEY IS NEVER DISPLAYED: setSecret takes the typed key and keeps it;
 * readSecret exists for the SEND and returns nothing else. The panels ask
 * keyExists (a boolean) to say "a key is set", and the value read for a send is
 * handed straight to the request line — never rendered, never logged, never
 * kept in React state.
 *
 * Refusals are VALUES: every call here answers, it never throws at the caller,
 * because a store that refuses is a sentence in the panel, not a broken app.
 *
 * PROVISIONAL: the status wording and the command names (mirrored in
 * src-tauri/src/secrets.rs).
 */

/** The three stores the host can report (see secrets.rs's SecretStatus). */
export type SecretStore = "keychain" | "fallback-file" | "unavailable";

/** A write that was kept, or the one sentence why it was not. */
export type SecretWrite =
  | { kind: "kept" }
  | { kind: "refused"; sentence: string };

/** The sentences the status line uses (PROVISIONAL wording). */
export const SECRET_SENTENCES = {
  keychain: "keys live in the OS keychain",
  fallback: "keys live in a local file — not the OS keychain",
  unavailable: "keys cannot be kept: no OS keychain and nowhere to write the local file",
} as const;

/** One quiet line, no stack traces: the panel shows a sentence, not an error. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isStore(value: unknown): value is SecretStore {
  return (
    value === "keychain" ||
    value === "fallback-file" ||
    value === "unavailable"
  );
}

/**
 * Which store holds keys RIGHT NOW. A host that cannot answer at all (a dev
 * page without Tauri, a broken command) says unavailable: the app must not
 * claim a keychain it could not ask.
 */
export async function secretStatus(): Promise<SecretStore> {
  try {
    const status = await invoke<unknown>("secret_status");
    return isStore(status) ? status : "unavailable";
  } catch {
    return "unavailable";
  }
}

/** Keep one provider's key. Write-only: nothing here returns the key. */
export async function setSecret(
  providerId: string,
  secret: string,
): Promise<SecretWrite> {
  if (secret === "") {
    return { kind: "refused", sentence: "an empty key is nothing to keep" };
  }
  try {
    await invoke("secret_set", { providerId, secret });
    return { kind: "kept" };
  } catch (error) {
    const sentence = oneLine(String(error));
    return {
      kind: "refused",
      sentence:
        sentence === "" ? "the key could not be kept" : sentence,
    };
  }
}

/**
 * The key for one provider, for ONE request line. The panels never call this
 * to fill a field: a send calls it, hands the answer to providerFrom, and
 * forgets it. An absent key is "" (a keyless local endpoint is legitimate).
 */
export async function readSecret(providerId: string): Promise<string> {
  try {
    const secret = await invoke<string | null>("secret_get", { providerId });
    return typeof secret === "string" ? secret : "";
  } catch {
    return "";
  }
}

/** Is a key kept for this provider? The answer the panel is allowed to show. */
export async function keyExists(providerId: string): Promise<boolean> {
  if (providerId === "") return false;
  return (await readSecret(providerId)) !== "";
}

/** Delete one provider's key (removing a row calls this first). */
export async function forgetSecret(
  providerId: string,
): Promise<SecretWrite> {
  try {
    await invoke("secret_delete", { providerId });
    return { kind: "kept" };
  } catch (error) {
    const sentence = oneLine(String(error));
    return {
      kind: "refused",
      sentence:
        sentence === "" ? "the key could not be deleted" : sentence,
    };
  }
}

/** The one sentence the panels show for a store — always, never only once. */
export function secretStatusWords(store: SecretStore): string {
  switch (store) {
    case "keychain":
      return SECRET_SENTENCES.keychain;
    case "fallback-file":
      return SECRET_SENTENCES.fallback;
    case "unavailable":
      return SECRET_SENTENCES.unavailable;
  }
}
