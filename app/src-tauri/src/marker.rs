//! The exclusive marker (Epic 10 story 1, ADR-0025 decision 2): the ghost
//! accept's in-flight sentinel.
//!
//! `create_exclusive` creates a file with `OpenOptions::create_new(true)` —
//! the Rust spelling of the `wx` open (O_EXCL on unix, CREATE_NEW on Windows).
//! It answers `Ok(true)` when THIS call created the file and `Ok(false)` when
//! it already existed, so the accept has ONE atomic answer to "may I proceed?".
//! The marker is IN-FLIGHT ONLY: nothing reads its bytes, a crash never resumes
//! it, and the frontend discards markers at open and releases a stale one
//! before re-claiming. The file is empty by construction — a sentinel, not a
//! record, and never a lock the app waits on.
//!
//! A missing parent folder is created first (the inbox may be brand new); every
//! other error is one clean line for the frontend.
//!
//! Provisional: the command's name and the empty-marker shape.

use std::fs;
use std::io;
use std::path::Path;

/// Create `path` exclusively. `Ok(true)` = created now; `Ok(false)` = it
/// already existed; `Err` = the call failed for another reason (permissions, a
/// directory at the path, ...).
pub fn create_exclusive(path: &str) -> Result<bool, String> {
    if let Some(parent) = Path::new(path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("create {}: {}", parent.display(), e))?;
        }
    }
    // A folder sitting at the marker path is not a marker: refuse it rather
    // than answer "already exists", so the accept's release never tries to
    // remove a folder. (create_new alone reports EEXIST for a folder too.)
    if fs::metadata(path)
        .map(|meta| meta.is_dir())
        .unwrap_or(false)
    {
        return Err(format!("not a marker file (a folder is there): {}", path));
    }
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
    {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => Ok(false),
        Err(e) => Err(format!("marker {}: {}", path, e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::UNIX_EPOCH;

    /// A unique temp directory, removed on drop (no new dependency for a test).
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new() -> TempDir {
            let mut path = std::env::temp_dir();
            let unique = format!(
                "attentioneer-marker-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            );
            path.push(unique);
            fs::create_dir_all(&path).unwrap();
            TempDir { path }
        }

        fn str(&self, name: &str) -> String {
            self.path.join(name).to_string_lossy().into_owned()
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn creates_a_fresh_marker_once() {
        let dir = TempDir::new();
        let path = dir.str("inbox/ghost-1.marker");
        assert_eq!(create_exclusive(&path), Ok(true));
        assert_eq!(create_exclusive(&path), Ok(false));
        // The marker is empty: a sentinel, not a record.
        assert_eq!(fs::read(&path).unwrap(), Vec::<u8>::new());
        assert!(Path::new(&path).is_file());
    }

    #[test]
    fn creates_the_parent_folder_on_the_way_in() {
        let dir = TempDir::new();
        let path = dir.str("a/b/c/ghost-2.marker");
        assert_eq!(create_exclusive(&path), Ok(true));
        assert!(Path::new(&dir.path.join("a/b/c")).is_dir());
    }

    #[test]
    fn an_existing_file_is_never_truncated() {
        let dir = TempDir::new();
        let path = dir.str("ghost-3.marker");
        fs::write(&path, b"keep me").unwrap();
        assert_eq!(create_exclusive(&path), Ok(false));
        assert_eq!(fs::read(&path).unwrap(), b"keep me");
    }

    #[test]
    fn a_directory_at_the_path_is_an_error() {
        let dir = TempDir::new();
        let path = dir.str("ghost-4.marker");
        fs::create_dir_all(&path).unwrap();
        assert!(create_exclusive(&path).is_err());
    }
}
