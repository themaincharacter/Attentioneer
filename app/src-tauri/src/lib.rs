use std::fs;
use std::path::Path;

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
            config_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}