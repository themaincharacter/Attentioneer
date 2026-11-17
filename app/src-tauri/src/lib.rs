use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};

mod bytes;
mod cli;
mod head;
mod local_runtime;
mod marker;
mod meta;
mod paths;
mod secrets;
mod sidecar;

/// Thin byte-level fs bridge. What machine files say and how they serialize
/// is owned by the frontend's `serialize.ts` (ADR-0004); this side only
/// moves bytes.

#[tauri::command]
fn read_text_file(path: String) -> Result<Option<String>, String> {
    match fs::read_to_string(&path) {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("read {}: {}", path, e)),
    }
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create {}: {}", parent.display(), e))?;
    }
    fs::write(&path, content).map_err(|e| format!("write {}: {}", path, e))
}

#[tauri::command]
fn create_dir_all(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| format!("create {}: {}", path, e))
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<String>, String> {
    let entries = match fs::read_dir(&path) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("list {}: {}", path, e)),
    };
    let mut names: Vec<String> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    Ok(names)
}

/// Rename a reference file when its slug changes (ADR-0005's atomic patch).
#[tauri::command]
fn rename_file(from: String, to: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&to).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create {}: {}", parent.display(), e))?;
    }
    fs::rename(&from, &to).map_err(|e| format!("rename {} -> {}: {}", from, to, e))
}

/// Remove a reference file (ADR-0007's atomic delete).
#[tauri::command]
fn remove_file(path: String) -> Result<(), String> {
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("remove {}: {}", path, e)),
    }
}

/// Remove a folder and its contents (Epic 8 story 2's retire verb). A missing
/// path is a quiet no-op, like `remove_file`; the frontend only ever calls it
/// on a scenario folder (`scenarios/<slug>/`) whose header it has already
/// removed, so the folder is not a scenario by the time anything is deleted.
#[tauri::command]
fn remove_dir_all(path: String) -> Result<(), String> {
    match fs::remove_dir_all(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("remove {}: {}", path, e)),
    }
}

/// The window's bounded glimpse of a text file (Epic 5 story 2, ADR-0017's
/// amendment): a read-only head plus the identity facts, for a pointer's
/// `path` or `at`. The implementation and its guards live in `head.rs`;
/// the arbitrary-path reach there is documented as a convention boundary,
/// not enforcement (app commands are not capability-gated). Read-only by
/// construction: there is no writer on this path.
#[tauri::command]
fn read_text_head(
    path: String,
    max_lines: usize,
    max_bytes: usize,
) -> Result<head::TextHead, head::HeadRefusal> {
    head::read(&path, max_lines, max_bytes)
}

/// The boundary layer's one realpath primitive (Epic 12 story 1, ADR-0029):
/// canonicalize a path AS FAR AS IT EXISTS — symlinks and `..` followed, a
/// missing tail kept from its deepest existing ancestor. The command refuses
/// nothing on scope grounds and knows no root: the pure resolver
/// (`contacts/boundary.ts`) compares the answer with the workspace root and
/// refuses the escape. The one-layer honesty is ADR-0029's; the
/// implementation and its tests live in `paths.rs`.
#[tauri::command]
fn canonicalize_path(path: String) -> Result<String, paths::PathRefusal> {
    paths::canonicalize(&path)
}

/// One file's WHOLE bytes for the ground map's one document extractor (story
/// 16.4, ADR-0035): pdf.js reads a PDF's text on device, so the bridge hands it
/// the document and nothing else. READ-ONLY BY CONSTRUCTION and hard-capped
/// (PROVISIONAL 96 MiB); the implementation, the guard shared with `head.rs`
/// and its tests live in `bytes.rs`. The answer travels as RAW BYTES
/// (`tauri::ipc::Response`): a `Vec<u8>` serialized as JSON would be an array
/// of millions of numbers, and the webview would spend more memory parsing the
/// envelope than holding the file.
#[tauri::command]
fn read_file_bytes(
    path: String,
    max_bytes: usize,
) -> Result<tauri::ipc::Response, bytes::BytesRefusal> {
    bytes::read(&path, max_bytes).map(tauri::ipc::Response::new)
}

/// One file's identity facts for the ground map's staleness reading (story
/// 16.2): whether the path names a regular file, its size and its modified
/// time. READ-ONLY BY CONSTRUCTION and it opens nothing — `fs::metadata` stats
/// the path, so the reading's "changed / missing / unreadable" state is
/// computed from metadata and never from the text (the implementation and its
/// tests live in `meta.rs`). A missing path is an honest `exists: false`;
/// every other OS failure is one line the bridge answers as a typed refusal
/// VALUE, so a dangling reading is a state, not an exception.
#[tauri::command]
fn file_meta(path: String) -> Result<meta::FileMeta, String> {
    meta::read(&path)
}

/// Create the ghost inbox's in-flight marker EXCLUSIVELY (Epic 10 story 1,
/// ADR-0025 decision 2): the `wx` open. `Ok(true)` when this call created it,
/// `Ok(false)` when a marker was already there. The implementation and its
/// tests live in `marker.rs`; the marker is never read and never resumed.
#[tauri::command]
fn create_marker_exclusive(path: String) -> Result<bool, String> {
    marker::create_exclusive(&path)
}

/// Which OS's file convention this build follows (story 15.9). Named rather
/// than read at every call, so the per-OS answer is a value a test can check
/// on any machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Platform {
    Linux,
    MacOs,
    Windows,
}

/// The one sentence a machine with nowhere to keep app files gets — a refusal
/// to say, never a panic.
const NO_CONFIG_DIR: &str =
    "the app cannot find its config directory: no HOME, XDG_CONFIG_HOME or APPDATA is set";

/// THE APP'S OWN DIRECTORY, PER OS (story 15.9).
///
/// WHY NOT `~/.config` EVERYWHERE: the config and the key fallback are the
/// APP's files, not this machine's Linux convention. The app ships builds for
/// Linux, macOS and Windows from one repository, so each OS keeps app data
/// where its people expect it: Linux stays under `$XDG_CONFIG_HOME` (else
/// `$HOME/.config`), joined with `attentioneer`, so nothing already written
/// moves; macOS uses
/// `$HOME/Library/Application Support/attentioneer`; Windows uses
/// `%APPDATA%\attentioneer`. ONE rule, one place: `config_path` and
/// `secrets::secrets_path` must never disagree about where the app's files
/// live.
///
/// THE DIRECTORY IS APP-SCOPED, NEVER PER-WORKSPACE: the provider rows, the
/// selection and the keys belong to the app — every workspace, and every OS
/// the app runs on, sees the same ones. A workspace folder holds the person's
/// map and notes; it never holds a key.
///
/// An empty variable counts as unset (the XDG rule), and a machine with none
/// of them gets ONE refusal sentence, never a panic.
fn config_dir_for(
    platform: Platform,
    xdg_config_home: Option<&OsStr>,
    home: Option<&OsStr>,
    appdata: Option<&OsStr>,
) -> Result<PathBuf, String> {
    let under = |base: &OsStr, rest: &[&str]| {
        let mut path = PathBuf::from(base);
        for part in rest {
            path.push(part);
        }
        path.push("attentioneer");
        path
    };
    fn nonempty(value: Option<&OsStr>) -> Option<&OsStr> {
        value.filter(|text| !text.is_empty())
    }
    match platform {
        Platform::Linux => {
            if let Some(xdg) = nonempty(xdg_config_home) {
                return Ok(under(xdg, &[]));
            }
            nonempty(home)
                .map(|home| under(home, &[".config"]))
                .ok_or_else(|| NO_CONFIG_DIR.to_string())
        }
        Platform::MacOs => nonempty(home)
            .map(|home| under(home, &["Library", "Application Support"]))
            .ok_or_else(|| NO_CONFIG_DIR.to_string()),
        Platform::Windows => nonempty(appdata)
            .map(|appdata| under(appdata, &[]))
            .ok_or_else(|| NO_CONFIG_DIR.to_string()),
    }
}

/// The config directory this OS keeps the app's files in.
pub(crate) fn config_dir() -> Result<PathBuf, String> {
    let platform = if cfg!(target_os = "windows") {
        Platform::Windows
    } else if cfg!(target_os = "macos") {
        Platform::MacOs
    } else {
        Platform::Linux
    };
    let xdg = std::env::var_os("XDG_CONFIG_HOME");
    let home = std::env::var_os("HOME");
    let appdata = std::env::var_os("APPDATA");
    config_dir_for(
        platform,
        xdg.as_deref(),
        home.as_deref(),
        appdata.as_deref(),
    )
}

/// The app-side config file (ADR-0002: the only app-side persistence).
#[tauri::command]
fn config_path() -> Result<String, String> {
    Ok(config_dir()?
        .join("config.json")
        .to_string_lossy()
        .into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // ADR-0034 decision 3: the host owns the sidecar's lifecycle. The
        // state holds the child and its pipe; `Drop` kills it, and the exit
        // hook below kills it earlier so the process list is clean the moment
        // the window closes.
        .manage(sidecar::SidecarState::default())
        // Story 15.6: the local runtime's child is ALSO the host's. One
        // managed state per long-lived child, and both are killed on exit.
        .manage(local_runtime::LocalRuntimeState::default())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            create_dir_all,
            path_exists,
            list_dir,
            rename_file,
            remove_file,
            remove_dir_all,
            read_text_head,
            canonicalize_path,
            create_marker_exclusive,
            file_meta,
            read_file_bytes,
            config_path,
            secrets::secret_status,
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_delete,
            sidecar::sidecar_start,
            sidecar::sidecar_send,
            sidecar::sidecar_status,
            cli::cli_where,
            cli::cli_probe,
            cli::cli_run,
            cli::cli_cancel,
            local_runtime::local_start,
            local_runtime::local_status,
            local_runtime::local_stop
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");
    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            use tauri::Manager;
            app_handle.state::<sidecar::SidecarState>().kill();
            app_handle
                .state::<local_runtime::LocalRuntimeState>()
                .kill();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn os(text: &str) -> &OsStr {
        OsStr::new(text)
    }

    /// The per-OS table (story 15.9), driven by the variables each platform
    /// reads rather than by the machine the test happens to run on. Linux
    /// stays exactly where it was; macOS and Windows get their own convention.
    #[test]
    fn the_config_directory_follows_the_os() {
        let cases: [(Platform, Option<&str>, Option<&str>, Option<&str>, PathBuf); 5] = [
            (
                Platform::Linux,
                Some("/xdg"),
                Some("/home/ada"),
                None,
                PathBuf::from("/xdg").join("attentioneer"),
            ),
            (
                Platform::Linux,
                None,
                Some("/home/ada"),
                None,
                PathBuf::from("/home/ada/.config").join("attentioneer"),
            ),
            // An empty variable is unset: `$XDG_CONFIG_HOME=""` is not a
            // directory named nothing.
            (
                Platform::Linux,
                Some(""),
                Some("/home/ada"),
                None,
                PathBuf::from("/home/ada/.config").join("attentioneer"),
            ),
            // macOS ignores XDG_CONFIG_HOME: one convention per OS.
            (
                Platform::MacOs,
                Some("/xdg"),
                Some("/Users/ada"),
                None,
                PathBuf::from("/Users/ada/Library/Application Support").join("attentioneer"),
            ),
            // Windows reads APPDATA and not HOME, even when HOME is set.
            (
                Platform::Windows,
                None,
                Some("C:/Users/ada"),
                Some("C:/Users/ada/AppData/Roaming"),
                PathBuf::from("C:/Users/ada/AppData/Roaming").join("attentioneer"),
            ),
        ];
        for (platform, xdg, home, appdata, expected) in cases {
            let got = config_dir_for(platform, xdg.map(os), home.map(os), appdata.map(os));
            assert_eq!(got, Ok(expected), "{platform:?}");
        }
    }

    /// No variable at all is a sentence the person can act on, not a panic.
    #[test]
    fn a_machine_with_nowhere_to_put_app_files_gets_one_sentence() {
        for platform in [Platform::Linux, Platform::MacOs, Platform::Windows] {
            let refused = config_dir_for(platform, Some(os("")), Some(os("")), Some(os("")));
            assert_eq!(refused, Err(NO_CONFIG_DIR.to_string()), "{platform:?}");
        }
        assert_eq!(
            NO_CONFIG_DIR,
            "the app cannot find its config directory: no HOME, XDG_CONFIG_HOME or APPDATA is set"
        );
    }

    /// The config and the key store are two files in ONE app-scoped directory;
    /// no workspace ever gets its own copy of either.
    #[test]
    fn the_config_and_the_key_store_share_one_app_scoped_directory() {
        let dir = config_dir().expect("this test machine has a home directory");
        assert_eq!(dir.file_name(), Some(os("attentioneer")));
        assert_eq!(
            PathBuf::from(config_path().unwrap()),
            dir.join("config.json")
        );
        assert_eq!(secrets::secrets_path().unwrap(), dir.join("secrets.json"));
    }
}
