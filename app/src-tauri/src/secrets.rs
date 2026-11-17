use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// WHERE A KEY LIVES (Epic 15 story 4).
///
/// WHY A KEYCHAIN AND NOT THE CONFIG: the config file is an ordinary text file
/// in a home directory — a backup, a synced folder or any process on the
/// machine can read it, and its whole job is to be readable by the next launch.
/// A key is not a setting: it is a capability, so it goes where the OS already
/// keeps capabilities, and the app asks for it at send time instead of holding
/// it. The config never grows a key field; nothing here writes one.
///
/// WHY A STATED FALLBACK AND NOT A SILENT ONE: this machine (a WSL box with
/// gnome-keyring present but no usable default collection) may have no working
/// Secret Service. A turn that cannot keep a key must still be usable, so ONE
/// local file (`secrets.json`) takes over — owner-only where the platform
/// allows it — and `secret_status` SAYS which store is in use, so the person
/// can weigh what they typed. The store is chosen per operation; a keychain
/// that answers the probe but fails a write is an error, never a quiet
/// downgrade to a file the person never agreed to.
///
/// The service name is the app's own; the account is the provider row's id, so
/// removing a row removes its key through the same path (`secret_delete`).

/// The keychain service every entry hangs off (the app's identity).
pub const SERVICE: &str = "attentioneer";

/// An account only the availability probe touches; no person ever names it.
const PROBE_ACCOUNT: &str = "__status_probe__";

/// Which store is in use: the one fact the panel always shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SecretStatus {
    /// The OS keychain holds every key (the preferred store).
    Keychain,
    /// One owner-only local file holds every key (the stated fallback).
    FallbackFile,
    /// Neither store works; a key cannot be kept at all, and the UI says so.
    Unavailable,
}

/// The keychain seam, injected so the fallback and the status can be tested on
/// a machine that has no Secret Service. Only `KeyringKeychain` is real.
pub trait Keychain {
    /// Did the OS keychain answer, with room to keep a key? A refusal here is
    /// the fallback's cue, never an error the person sees on its own.
    fn available(&self) -> bool;
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    fn set(&self, account: &str, secret: &str) -> Result<(), String>;
    fn delete(&self, account: &str) -> Result<(), String>;
}

/// The `keyring` crate's Secret Service store: the preferred one.
pub struct KeyringKeychain;

/// The probe's answer, cached for the whole process: it is a WRITE, and a
/// locked keychain must not be tested (or prompted) once per command.
static KEYCHAIN_PROBED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();

/// Can a key actually LIVE in the OS keychain on this machine?
///
/// A read is not proof: this WSL box's gnome-keyring answers reads with
/// NoEntry and then refuses every write because it has no default collection
/// (ReadAlias "default" is "/"). So the probe WRITES one throwaway key on a
/// reserved account and deletes it at once — the only honest test of "is there
/// a place to keep a key" — and caches the answer for this process. A keychain
/// that is merely locked reports unavailable here and the stated file fallback
/// takes over; unlocking it later is visible the next time the app starts.
fn probe_keychain() -> bool {
    *KEYCHAIN_PROBED.get_or_init(|| {
        let entry = match keyring::Entry::new(SERVICE, PROBE_ACCOUNT) {
            Ok(entry) => entry,
            Err(_) => return false,
        };
        match entry.get_password() {
            Ok(_) => true,
            Err(keyring::Error::NoEntry) => {
                match entry.set_password("attentioneer-availability-probe") {
                    Ok(()) => {
                        let _ = entry.delete_credential();
                        true
                    }
                    Err(_) => false,
                }
            }
            Err(_) => false,
        }
    })
}

impl Keychain for KeyringKeychain {
    fn available(&self) -> bool {
        probe_keychain()
    }

    fn get(&self, account: &str) -> Result<Option<String>, String> {
        let entry = keyring::Entry::new(SERVICE, account)
            .map_err(|e| format!("the OS keychain refused the entry: {e}"))?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("the OS keychain could not answer: {e}")),
        }
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(SERVICE, account)
            .map_err(|e| format!("the OS keychain refused the entry: {e}"))?;
        entry
            .set_password(secret)
            .map_err(|e| format!("the OS keychain refused the key: {e}"))
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(SERVICE, account)
            .map_err(|e| format!("the OS keychain refused the entry: {e}"))?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("the OS keychain could not delete the key: {e}")),
        }
    }
}

/// The key store: whichever of the two homes answers, decided per operation so
/// the status the panel shows and the write that follows agree.
pub struct Secrets {
    keychain: Box<dyn Keychain>,
    fallback_path: PathBuf,
}

impl Secrets {
    /// The real store: the keychain first, the app config directory's
    /// `secrets.json` as the stated fallback.
    pub fn open(fallback_path: PathBuf) -> Self {
        Self {
            keychain: Box::new(KeyringKeychain),
            fallback_path,
        }
    }

    /// A store with an injected keychain: the fallback and the status are
    /// tested without a session bus (the check below cannot be run on CI).
    #[cfg(test)]
    fn with_keychain(keychain: Box<dyn Keychain>, fallback_path: PathBuf) -> Self {
        Self {
            keychain,
            fallback_path,
        }
    }

    /// Which store is in use RIGHT NOW. Keychain first; the file only when the
    /// keychain cannot answer; unavailable when neither can.
    pub fn status(&self) -> SecretStatus {
        if self.keychain.available() {
            SecretStatus::Keychain
        } else if fallback_ready(&self.fallback_path) {
            SecretStatus::FallbackFile
        } else {
            SecretStatus::Unavailable
        }
    }

    /// Keep one provider's key. The chosen store is the one `status` reports:
    /// a keychain that fails here is an error, not a license to write a file.
    pub fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        check_account(account)?;
        if secret.is_empty() {
            return Err("an empty key is nothing to keep".to_string());
        }
        if self.keychain.available() {
            return self.keychain.set(account, secret);
        }
        fallback_set(&self.fallback_path, account, secret)
    }

    /// The key for one provider, or `None` when none was kept there.
    pub fn get(&self, account: &str) -> Result<Option<String>, String> {
        check_account(account)?;
        if self.keychain.available() {
            return self.keychain.get(account);
        }
        fallback_get(&self.fallback_path, account)
    }

    /// Delete one provider's key (removing the row deletes it through here).
    /// A missing key is a quiet no-op: the goal is "no key", not "did one".
    pub fn delete(&self, account: &str) -> Result<(), String> {
        check_account(account)?;
        if self.keychain.available() {
            return self.keychain.delete(account);
        }
        fallback_delete(&self.fallback_path, account)
    }
}

fn check_account(account: &str) -> Result<(), String> {
    if account.trim().is_empty() {
        return Err("a provider id is needed to keep a key".to_string());
    }
    if account.contains('\0') {
        return Err("a provider id cannot contain a NUL byte".to_string());
    }
    Ok(())
}

/// The config directory's one secrets file (beside `config.json`).
pub fn secrets_path() -> Result<PathBuf, String> {
    let home = crate::home_dir()?;
    Ok(PathBuf::from(home)
        .join(".config")
        .join("attentioneer")
        .join("secrets.json"))
}

fn store() -> Result<Secrets, String> {
    Ok(Secrets::open(secrets_path()?))
}

/* ------------------------------------------------------------------ *
 * The fallback file — ONE owner-only file, and the same JSON discipline as
 * every machine file the app writes (a plain object of account -> key).
 * ------------------------------------------------------------------ */

/// Can the fallback file be written? The parent directory must be creatable,
/// and an existing file must be both readable (we merge into it) and writable
/// (we will replace it).
fn fallback_ready(path: &Path) -> bool {
    let Some(parent) = path.parent() else {
        return false;
    };
    if fs::create_dir_all(parent).is_err() {
        return false;
    }
    if path.exists() {
        return fallback_read(path).is_ok()
            && OpenOptions::new().write(true).open(path).is_ok();
    }
    // No file yet: a probe beside it proves the directory takes a write.
    let probe = parent.join(".attentioneer-write-probe");
    match OpenOptions::new().write(true).create_new(true).open(&probe) {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

fn fallback_read(path: &Path) -> Result<BTreeMap<String, String>, String> {
    match fs::read_to_string(path) {
        Ok(text) => {
            if text.trim().is_empty() {
                return Ok(BTreeMap::new());
            }
            serde_json::from_str::<BTreeMap<String, String>>(&text)
                .map_err(|e| format!("the local secrets file could not be read: {e}"))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(e) => Err(format!("the local secrets file could not be read: {e}")),
    }
}

/// Write the whole object back, atomically and owner-only: a temp file in the
/// same directory (created 0600), then a rename. The old file is never opened
/// for truncation, so a crash mid-write cannot leave half a key map behind.
fn fallback_write(path: &Path, secrets: &BTreeMap<String, String>) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "the local secrets file has no directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|e| format!("the local secrets directory could not be made: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(parent, fs::Permissions::from_mode(0o700));
    }
    let text = serde_json::to_string(secrets)
        .map_err(|e| format!("the local secrets file could not be written: {e}"))?;
    let temp = path.with_extension("json.tmp");
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temp)
        .map_err(|e| format!("the local secrets file could not be written: {e}"))?;
    file.write_all(text.as_bytes())
        .and_then(|()| file.sync_all())
        .map_err(|e| format!("the local secrets file could not be written: {e}"))?;
    drop(file);
    fs::rename(&temp, path)
        .map_err(|e| format!("the local secrets file could not be replaced: {e}"))?;
    // An older file (or a copied one) may have wider permissions; the rename
    // carries the temp file's 0600, and this makes that a guarantee.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn fallback_set(path: &Path, account: &str, secret: &str) -> Result<(), String> {
    let mut secrets = fallback_read(path)?;
    secrets.insert(account.to_string(), secret.to_string());
    fallback_write(path, &secrets)
}

fn fallback_get(path: &Path, account: &str) -> Result<Option<String>, String> {
    Ok(fallback_read(path)?.get(account).cloned())
}

fn fallback_delete(path: &Path, account: &str) -> Result<(), String> {
    let mut secrets = fallback_read(path)?;
    if secrets.remove(account).is_none() {
        return Ok(());
    }
    fallback_write(path, &secrets)
}

/* ------------------------------------------------------------------ *
 * The four commands the window may call (mirrored in `lib/secret.ts`).
 * ------------------------------------------------------------------ */

/// Which store holds keys (the panel's status sentence is built from this).
#[tauri::command]
pub fn secret_status() -> Result<SecretStatus, String> {
    Ok(store()?.status())
}

/// Keep ONE provider's key. Write-only from the UI's point of view: nothing
/// ever brings it back for display, and no error line embeds it.
#[tauri::command]
pub fn secret_set(provider_id: String, secret: String) -> Result<(), String> {
    store()?.set(&provider_id, &secret)
}

/// The key for ONE provider, read at send time and nowehere else. The window
/// asks for it to build one request line; it is never rendered or logged.
#[tauri::command]
pub fn secret_get(provider_id: String) -> Result<Option<String>, String> {
    store()?.get(&provider_id)
}

/// Delete ONE provider's key. Removing the row calls this first.
#[tauri::command]
pub fn secret_delete(provider_id: String) -> Result<(), String> {
    store()?.delete(&provider_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// A keychain that answers NOTHING: this machine's honest stand-in for a
    /// WSL box with no usable Secret Service collection.
    struct Absent;
    impl Keychain for Absent {
        fn available(&self) -> bool {
            false
        }
        fn get(&self, _account: &str) -> Result<Option<String>, String> {
            Err("no keychain".to_string())
        }
        fn set(&self, _account: &str, _secret: &str) -> Result<(), String> {
            Err("no keychain".to_string())
        }
        fn delete(&self, _account: &str) -> Result<(), String> {
            Err("no keychain".to_string())
        }
    }

    /// A keychain that answers and keeps keys in memory: the status must say
    /// `keychain` and NO fallback file may be written.
    #[derive(Default)]
    struct Present {
        keys: std::sync::Mutex<BTreeMap<String, String>>,
    }
    impl Keychain for Present {
        fn available(&self) -> bool {
            true
        }
        fn get(&self, account: &str) -> Result<Option<String>, String> {
            Ok(self.keys.lock().unwrap().get(account).cloned())
        }
        fn set(&self, account: &str, secret: &str) -> Result<(), String> {
            self.keys
                .lock()
                .unwrap()
                .insert(account.to_string(), secret.to_string());
            Ok(())
        }
        fn delete(&self, account: &str) -> Result<(), String> {
            self.keys.lock().unwrap().remove(account);
            Ok(())
        }
    }

    /// A keychain that claims to be there and then refuses the write: the
    /// store must answer the error, NOT quietly fall back to the file.
    struct Refuses;
    impl Keychain for Refuses {
        fn available(&self) -> bool {
            true
        }
        fn get(&self, _account: &str) -> Result<Option<String>, String> {
            Err("the OS keychain could not answer".to_string())
        }
        fn set(&self, _account: &str, _secret: &str) -> Result<(), String> {
            Err("the OS keychain refused the key".to_string())
        }
        fn delete(&self, _account: &str) -> Result<(), String> {
            Err("the OS keychain could not delete the key".to_string())
        }
    }

    fn temp_path(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!(
                "attentioneer-secrets-{tag}-{}-{nanos}",
                std::process::id()
            ))
            .join("secrets.json")
    }

    fn clean(path: &Path) {
        if let Some(parent) = path.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }


    #[test]
    fn the_fallback_file_keeps_reads_and_deletes_keys() {
        let path = temp_path("round-trip");
        let store = Secrets::with_keychain(Box::new(Absent), path.clone());

        assert_eq!(store.status(), SecretStatus::FallbackFile);
        assert_eq!(store.get("local-llama").unwrap(), None);

        store.set("local-llama", "sk-local").unwrap();
        assert_eq!(
            store.get("local-llama").unwrap(),
            Some("sk-local".to_string())
        );

        // A second row does not disturb the first (one file, many accounts).
        store.set("other", "sk-other").unwrap();
        assert_eq!(store.get("local-llama").unwrap(), Some("sk-local".to_string()));
        assert_eq!(store.get("other").unwrap(), Some("sk-other".to_string()));

        // The fallback file's STRUCTURE is one flat account -> key object: no
        // provider name, no base URL, no selection, no model list. The key is
        // the only thing the file knows, and it knows it under the row's id.
        let text = fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        let object = parsed.as_object().expect("the fallback file is one object");
        let mut accounts: Vec<&String> = object.keys().collect();
        accounts.sort();
        assert_eq!(accounts, vec!["local-llama", "other"]);
        for value in object.values() {
            assert!(value.is_string(), "every account maps to its key string");
        }

        // Removing the row's key leaves the other one alone; deleting a
        // key that is not there is a quiet no-op.
        store.delete("local-llama").unwrap();
        assert_eq!(store.get("local-llama").unwrap(), None);
        assert_eq!(store.get("other").unwrap(), Some("sk-other".to_string()));
        store.delete("never-there").unwrap();
        clean(&path);
    }

    #[cfg(unix)]
    #[test]
    fn the_fallback_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let path = temp_path("permissions");
        let store = Secrets::with_keychain(Box::new(Absent), path.clone());
        store.set("local-llama", "sk-local").unwrap();

        let file_mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(file_mode, 0o600, "the secrets file must be owner-only");
        let dir_mode = fs::metadata(path.parent().unwrap())
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(dir_mode, 0o700, "the secrets directory must be owner-only");
        clean(&path);
    }

    #[test]
    fn status_says_keychain_when_the_probe_answers() {
        let path = temp_path("status-keychain");
        let store = Secrets::with_keychain(Box::new(Present::default()), path.clone());
        assert_eq!(store.status(), SecretStatus::Keychain);
        // The keychain was chosen, so the fallback file must not exist.
        store.set("local-llama", "sk-local").unwrap();
        assert!(!path.exists(), "a working keychain never writes the file");
        clean(&path);
    }

    #[test]
    fn status_says_unavailable_when_neither_store_works() {
        let root = temp_path("status-none");
        // The fallback's parent is itself a FILE, so no directory (and so no
        // secrets file) can be made there: neither store is usable.
        let blocker = root.parent().unwrap().to_path_buf();
        fs::write(&blocker, b"not a directory").unwrap();
        let store = Secrets::with_keychain(Box::new(Absent), root.clone());
        assert_eq!(store.status(), SecretStatus::Unavailable);
        assert!(store.set("local-llama", "sk-local").is_err());
        let _ = fs::remove_file(&blocker);
        clean(&root);
    }

    #[test]
    fn a_failing_keychain_is_an_error_not_a_silent_fallback() {
        let path = temp_path("no-silent-fallback");
        let store = Secrets::with_keychain(Box::new(Refuses), path.clone());
        assert_eq!(store.status(), SecretStatus::Keychain);
        let refused = store.set("local-llama", "sk-local");
        assert!(refused.is_err());
        assert!(!path.exists(), "the fallback must not be written silently");
        clean(&path);
    }

    #[test]
    fn a_key_needs_a_provider_and_is_never_empty() {
        let path = temp_path("refusals");
        let store = Secrets::with_keychain(Box::new(Absent), path.clone());
        assert!(store.set("   ", "sk-local").is_err());
        assert!(store.set("local-llama", "").is_err());
        assert!(!path.exists());
        clean(&path);
    }
}
