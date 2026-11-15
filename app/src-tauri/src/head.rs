//! The window's bounded head-of-file read (Epic 5 story 2, ADR-0017's
//! amendment; the research's "cheapest sound approach").
//!
//! read_text_head returns a SMALL glimpse of a text file: a bounded head, cut
//! on a UTF-8 char boundary, plus the identity facts the window shows first
//! (exists, size, mtime). It is READ-ONLY BY CONSTRUCTION: the module contains
//! no writer, no remove and no rename, so "an outward read must never write"
//! is a property of the code, not of discipline.
//!
//! THE REACH IS ARBITRARY PATHS, AND THAT IS A CONVENTION BOUNDARY, NOT
//! ENFORCEMENT. App-registered Tauri commands are not gated or scoped by the
//! capability system (the research's section 2.3), so this command reads
//! whatever path the pointer names: inside the workspace, an authored absolute
//! 'at', or anywhere else the process can read. The app's "the workspace is the
//! only source of truth" is a convention the frontend keeps; nothing here
//! builds a sandbox. The only guard is structural, not a policy: regular files
//! only (stat first: directories, FIFOs, sockets, devices and /proc, /sys,
//! /dev-style pseudo files are refused), bounded memory, and a bounded
//! byte/line budget. Resolution follows the filesystem as written; the command
//! never trims, repairs or interprets the authored path (World B).
//!
//! Provisional: the binary guard (a NUL byte means "not text"), the pseudo
//! filesystem refusal, and the lossy decoding of stray invalid UTF-8.

use std::fs;
use std::io::{self, Read};
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// One bounded glimpse of a text file. Every field is display data; nothing
/// here is stored anywhere (the window is a snapshot of the open moment).
#[derive(Debug, Serialize)]
pub struct TextHead {
    /// The readable prefix: bounded by lines AND bytes, cut on a char
    /// boundary, so it is always valid UTF-8 text.
    pub head: String,
    /// The file says more than the bounds returned.
    pub truncated: bool,
    /// A regular file was there to read. False means the path is absent (or
    /// dangling): the window says "cannot read" rather than an IO error.
    pub exists: bool,
    /// The file's size in bytes, when it exists.
    pub size: Option<u64>,
    /// Last modification, milliseconds since the Unix epoch, when known.
    pub mtime: Option<i64>,
}

impl TextHead {
    fn absent() -> TextHead {
        TextHead {
            head: String::new(),
            truncated: false,
            exists: false,
            size: None,
            mtime: None,
        }
    }
}

/// Read at most max_lines lines and max_bytes bytes of a regular text file.
///
/// Order of the guards, deliberately: stat first (a missing path is an honest
/// "absent", not an error), then the regular-file guard (nothing special is
/// ever opened), then the bounded read, then the binary guard and the bounds.
/// Errors are clean one-line strings; the frontend turns every one of them into
/// the same quiet "cannot read".
pub fn read(path: &str, max_lines: usize, max_bytes: usize) -> Result<TextHead, String> {
    // Stat first: never open a directory, a FIFO or a device.
    let meta = match fs::metadata(path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(TextHead::absent()),
        Err(e) => return Err(format!("read {}: {}", path, e)),
    };
    if !meta.is_file() || is_pseudo_path(path) {
        return Err(format!("not a regular file: {}", path));
    }

    let size = meta.len();
    let mtime = meta
        .modified()
        .ok()
        .and_then(|when| when.duration_since(UNIX_EPOCH).ok())
        .map(|since| since.as_millis() as i64);

    if max_lines == 0 || max_bytes == 0 {
        return Ok(TextHead {
            head: String::new(),
            truncated: size > 0,
            exists: true,
            size: Some(size),
            mtime,
        });
    }

    // The byte cap short-circuits the read: one extra byte tells us whether the
    // file goes on, so a 400 MB log costs at most max_bytes + 1 bytes here.
    let budget = (max_bytes as u64).saturating_add(1);
    let mut raw: Vec<u8> = Vec::new();
    let file = fs::File::open(path).map_err(|e| format!("read {}: {}", path, e))?;
    io::BufReader::new(file)
        .take(budget)
        .read_to_end(&mut raw)
        .map_err(|e| format!("read {}: {}", path, e))?;

    // A NUL byte means the head is not text: refuse rather than render bytes as
    // replacement characters. Provisional (the research's "cannot preview").
    if raw.contains(&0) {
        return Err(format!("not a text file: {}", path));
    }

    let byte_truncated = raw.len() > max_bytes;
    let mut end = raw.len().min(max_bytes);
    end = char_boundary(&raw, end);

    // The line cap: cut after the max_lines-th newline when more follows.
    let mut line_truncated = false;
    let mut seen = 0usize;
    for (index, byte) in raw[..end].iter().enumerate() {
        if *byte != b'\n' {
            continue;
        }
        seen += 1;
        if seen == max_lines {
            if index + 1 < end {
                end = index + 1;
                line_truncated = true;
            }
            break;
        }
    }

    Ok(TextHead {
        head: String::from_utf8_lossy(&raw[..end]).into_owned(),
        truncated: byte_truncated || line_truncated,
        exists: true,
        size: Some(size),
        mtime,
    })
}

/// The /proc, /sys and /dev style pseudo filesystems: their entries can report
/// as regular files while reading may block or answer with kernel data.
/// Refused by name, before anything is opened. A convention guard, like the
/// reach itself: it keeps a glimpse from blocking, it does not sandbox reads.
fn is_pseudo_path(path: &str) -> bool {
    // Only an absolute path can name a pseudo root; a workspace file that
    // happens to sit in a directory called "dev/" is an ordinary file.
    if !path.starts_with('/') {
        return false;
    }
    let first = path.trim_start_matches('/').split('/').next().unwrap_or("");
    matches!(first, "proc" | "sys" | "dev")
}

/// Where a UTF-8 code point ends at or before limit: never split a sequence,
/// so the returned prefix is always decodable text (invalid bytes inside it are
/// the lossy decoder's business, not a boundary problem).
fn char_boundary(raw: &[u8], limit: usize) -> usize {
    let limit = limit.min(raw.len());
    if limit == raw.len() {
        return limit;
    }
    // Walk back over continuation bytes to the lead byte of the sequence that
    // straddles the limit, then keep the sequence only when it is complete.
    let mut start = limit;
    while start > 0 && (raw[start - 1] & 0xC0) == 0x80 {
        start -= 1;
    }
    if start == 0 {
        return 0;
    }
    let lead_index = start - 1;
    let lead = raw[lead_index];
    let need = if lead >= 0xF0 {
        4
    } else if lead >= 0xE0 {
        3
    } else if lead >= 0xC0 {
        2
    } else {
        1
    };
    if need > limit - lead_index {
        lead_index
    } else {
        limit
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    /// A unique temp directory, removed on drop (no new dependency for a test).
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new() -> TempDir {
            let mut path = std::env::temp_dir();
            let unique = format!(
                "attentioneer-head-{}-{}",
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

    fn head_of(bytes: &[u8], lines: usize, bytes_cap: usize) -> TextHead {
        let dir = TempDir::new();
        dir.file("f.txt", bytes);
        read(&dir.str("f.txt"), lines, bytes_cap).unwrap()
    }

    #[test]
    fn reads_a_small_file_whole() {
        let text = head_of(b"one\ntwo\n", 100, 1000);
        assert_eq!(text.head, "one\ntwo\n");
        assert!(!text.truncated);
        assert!(text.exists);
        assert_eq!(text.size, Some(8));
        assert!(text.mtime.is_some());
    }

    #[test]
    fn a_missing_file_is_absent_not_an_error() {
        let dir = TempDir::new();
        let text = read(&dir.str("gone.txt"), 10, 100).unwrap();
        assert!(!text.exists);
        assert_eq!(text.size, None);
        assert_eq!(text.mtime, None);
        assert_eq!(text.head, "");
        assert!(!text.truncated);
    }

    #[test]
    fn the_byte_cap_short_circuits_and_says_truncated() {
        let bytes = vec![b'a'; 5000];
        let text = head_of(&bytes, 400, 10);
        assert_eq!(text.head, "aaaaaaaaaa");
        assert!(text.truncated);
        // The stat identity is the whole file's, not the head's.
        assert_eq!(text.size, Some(5000));
    }

    #[test]
    fn the_line_cap_says_truncated() {
        let text = head_of(b"l1\nl2\nl3\n", 2, 100);
        assert_eq!(text.head, "l1\nl2\n");
        assert!(text.truncated);
    }

    #[test]
    fn an_exact_fit_is_not_truncated() {
        let text = head_of(b"a\nb\n", 2, 4);
        assert_eq!(text.head, "a\nb\n");
        assert!(!text.truncated);
    }

    #[test]
    fn the_head_never_splits_a_char() {
        // Two-byte char, one byte of budget: nothing complete fits.
        let text = head_of("é".as_bytes(), 10, 1);
        assert_eq!(text.head, "");
        assert!(text.truncated);

        // One ascii byte then a two-byte char with two bytes of budget.
        let text = head_of("aé".as_bytes(), 10, 2);
        assert_eq!(text.head, "a");
        assert!(text.truncated);

        // A three-byte char fits exactly.
        let text = head_of("€x".as_bytes(), 10, 3);
        assert_eq!(text.head, "€");
        assert!(text.truncated);

        // A partial four-byte char is dropped whole.
        let text = head_of("𝄞x".as_bytes(), 10, 3);
        assert_eq!(text.head, "");
        assert!(text.truncated);
        let text = head_of("𝄞x".as_bytes(), 10, 4);
        assert_eq!(text.head, "𝄞");
        assert!(text.truncated);
    }

    #[test]
    fn pseudo_roots_are_refused_by_absolute_name_only() {
        assert!(is_pseudo_path("/proc/self/status"));
        assert!(is_pseudo_path("/sys/kernel"));
        assert!(is_pseudo_path("/dev/null"));
        // A relative path that merely starts with "dev/" is an ordinary file.
        assert!(!is_pseudo_path("dev/x"));
        assert!(!is_pseudo_path("/home/k/dev/x"));
    }

    #[test]
    fn char_boundary_edges() {
        assert_eq!(char_boundary(b"abc", 2), 2);
        assert_eq!(char_boundary("é".as_bytes(), 1), 0);
        assert_eq!(char_boundary("aé".as_bytes(), 2), 1);
        assert_eq!(char_boundary("€x".as_bytes(), 3), 3);
        assert_eq!(char_boundary("€x".as_bytes(), 2), 0);
        assert_eq!(char_boundary(b"", 10), 0);
    }

    #[test]
    fn invalid_utf8_without_a_nul_is_decoded_lossily() {
        let text = head_of(&[0xff, b'a', b'\n'], 10, 100);
        assert!(text.head.contains('a'));
        assert!(text.head.contains('\u{FFFD}'));
        assert!(text.exists);
    }

    #[test]
    fn a_binary_head_is_refused_not_rendered() {
        let dir = TempDir::new();
        dir.file("f.bin", &[0x89, b'P', b'N', b'G', 0x00, 0x01]);
        let error = read(&dir.str("f.bin"), 10, 100).unwrap_err();
        assert!(error.contains("not a text file"), "{}", error);
    }

    #[test]
    fn zero_bounds_return_an_empty_head() {
        let text = head_of(b"anything\n", 0, 100);
        assert_eq!(text.head, "");
        assert!(text.truncated);
        assert!(text.exists);
    }

    #[test]
    fn a_directory_is_refused_regular_files_only() {
        let dir = TempDir::new();
        fs::create_dir_all(dir.path.join("sub")).unwrap();
        let error = read(&dir.str("sub"), 10, 100).unwrap_err();
        assert!(error.contains("not a regular file"), "{}", error);
    }

    #[cfg(unix)]
    #[test]
    fn devices_and_pseudo_files_are_refused_before_reading() {
        if Path::new("/dev/null").exists() {
            let error = read("/dev/null", 10, 100).unwrap_err();
            assert!(error.contains("not a regular file"), "{}", error);
        }
        if Path::new("/proc/self/status").exists() {
            let error = read("/proc/self/status", 10, 100).unwrap_err();
            assert!(error.contains("not a regular file"), "{}", error);
        }
        if Path::new("/sys/kernel").exists() {
            let error = read("/sys/kernel", 10, 100).unwrap_err();
            assert!(error.contains("not a regular file"), "{}", error);
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_fifo_is_refused_not_opened() {
        let dir = TempDir::new();
        let fifo = dir.path.join("pipe");
        let status = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .expect("mkfifo");
        assert!(status.success());
        use std::os::unix::fs::FileTypeExt;
        assert!(fs::metadata(&fifo).unwrap().file_type().is_fifo());
        let error = read(&fifo.to_string_lossy(), 10, 100).unwrap_err();
        assert!(error.contains("not a regular file"), "{}", error);
    }

    #[test]
    fn nested_paths_are_read_verbatim() {
        let dir = TempDir::new();
        fs::create_dir_all(dir.path.join("notes")).unwrap();
        fs::write(dir.path.join("notes").join("x.md"), b"# x\n").unwrap();
        let relative = dir.path.join("notes").join("x.md");
        let text = read(&relative.to_string_lossy(), 10, 100).unwrap();
        assert_eq!(text.head, "# x\n");
    }
}
