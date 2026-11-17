use std::fs;
use std::path::Path;

mod bytes;
mod head;
mod marker;
mod meta;
mod paths;

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

/// The app-side config file (ADR-0002: the only app-side persistence).
#[tauri::command]
fn config_path() -> Result<String, String> {
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE"));
    let home = home.map_err(|_| "home directory is not set".to_string())?;
    Ok(format!("{}/.config/attentioneer/config.json", home))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            config_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
