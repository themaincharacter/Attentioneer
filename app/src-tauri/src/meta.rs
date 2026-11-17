//! One file's identity facts, for the ground map's staleness reading
//! (story 16.2).
//!
//! `file_meta` answers the ONE question staleness asks WITHOUT reading a byte:
//! does the path name a regular file, how large is it, and when was it modified?
//! The ground map takes a reading's head once, at the person's pick, and later
//! compares the file's SIZE and MODIFIED TIME with what the reading recorded.
//! This is METADATA, never a hash and never the text: the map may say "has
//! changed since this reading", and must never say the text differs.
//!
//! READ-ONLY BY CONSTRUCTION: there is no writer, no rename and no remove
//! here, and no file is opened — `fs::metadata` stats the path. A missing path
//! is an honest `exists: false` (the map says "missing"), never an error.
//! Every other filesystem failure is one `Err` string the bridge turns into a
//! typed refusal value (the map says "unreadable"): the frontend's `fileMeta`
//! answers a REFUSAL AS A VALUE, never a throw, so a dangling reading is a
//! state and not an exception.
//!
//! No pseudo-filesystem guard here, deliberately: `head.rs` refuses /proc, /sys
//! and /dev because reading their entries can block or answer with kernel data.
//! A stat opens nothing and reads no bytes, so the same guard would refuse a
//! harmless fact for a reason that does not apply.
//!
//! Provisional: the field names, the millisecond epoch and the one refusal
//! (anything the OS refuses is "cannot stat", the map's "unreadable").

use std::fs;
use std::io;
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// One path's identity facts. Display data only: nothing is stored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileMeta {
    /// The path resolves to something right now.
    pub exists: bool,
    /// It is a REGULAR file (a folder, FIFO, device or dangling link is not).
    pub is_file: bool,
    /// The file's size in bytes, when it is a regular file.
    pub len: Option<u64>,
    /// Last modification, milliseconds since the Unix epoch, when known.
    pub modified_ms: Option<i64>,
}

impl FileMeta {
    fn absent() -> FileMeta {
        FileMeta {
            exists: false,
            is_file: false,
            len: None,
            modified_ms: None,
        }
    }
}

/// Stat one path. A missing path is `absent`, not an error; a non-regular
/// path (a folder, a FIFO) reports `exists: true, is_file: false` with no
/// size or time; any other OS failure is one `Err` line for the bridge.
pub fn read(path: &str) -> Result<FileMeta, String> {
    let meta = match fs::metadata(path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(FileMeta::absent()),
        Err(e) => return Err(format!("stat {}: {}", path, e)),
    };
    if !meta.is_file() {
        return Ok(FileMeta {
            exists: true,
            is_file: false,
            len: None,
            modified_ms: None,
        });
    }
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|when| when.duration_since(UNIX_EPOCH).ok())
        .map(|since| since.as_millis() as i64);
    Ok(FileMeta {
        exists: true,
        is_file: true,
        len: Some(meta.len()),
        modified_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A unique temp directory, removed on drop (no new dependency for a test).
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new() -> TempDir {
            let mut path = std::env::temp_dir();
            let unique = format!(
                "attentioneer-meta-{}-{}",
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

        fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.path.join(name);
            fs::write(&path, bytes).unwrap();
            path
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
    fn a_regular_file_reports_its_size_and_time() {
        let dir = TempDir::new();
        dir.file("gauge.txt", b"one line\n");
        let meta = read(&dir.str("gauge.txt")).unwrap();
        assert!(meta.exists);
        assert!(meta.is_file);
        assert_eq!(meta.len, Some(9));
        assert!(meta.modified_ms.is_some());
    }

    #[test]
    fn a_missing_path_is_absent_not_an_error() {
        let dir = TempDir::new();
        let meta = read(&dir.str("gone.txt")).unwrap();
        assert!(!meta.exists);
        assert!(!meta.is_file);
        assert_eq!(meta.len, None);
        assert_eq!(meta.modified_ms, None);
    }

    #[test]
    fn a_directory_exists_but_is_not_a_file() {
        let dir = TempDir::new();
        let meta = read(&dir.str("")).unwrap();
        assert!(meta.exists);
        assert!(!meta.is_file);
        assert_eq!(meta.len, None);
    }

    #[test]
    fn a_bad_path_is_one_error_and_the_facts_never_travel_as_asked() {
        // A NUL byte is not a path: the OS refuses the stat. The map shows
        // "unreadable" (the bridge's value) rather than an exception.
        let result = read("bad\0path.txt");
        assert!(result.is_err());
    }

    #[test]
    fn the_facts_serialize_with_the_frontends_field_names() {
        let meta = FileMeta {
            exists: true,
            is_file: true,
            len: Some(12),
            modified_ms: Some(1_700_000_000_000),
        };
        assert_eq!(
            serde_json::to_string(&meta).unwrap(),
            r#"{"exists":true,"is_file":true,"len":12,"modified_ms":1700000000000}"#
        );
    }
}
