//! The window's WHOLE-FILE byte read (story 16.4, ADR-0035).
//!
//! read_file_bytes hands the one on-device document extractor (pdf.js, behind
//! `map/extract.ts`) the bytes of a file the person pointed at. It exists
//! because a PDF's text is not a head read: the extractor needs the whole
//! document, and no part of it is stored — the original stays where the person
//! put it, and this module never copies, parses or interprets it.
//!
//! READ-ONLY BY CONSTRUCTION: unlike `head.rs`, this module has no writer, no
//! remove and no rename. It stats, it opens, it reads, it returns.
//!
//! THE GUARDS, in order, deliberately: the pseudo-filesystem refusal comes
//! first (refused by NAME, before anything is touched, so a /proc or /dev entry
//! can never block the webview on a read), then the stat (a missing path is an
//! honest refusal, not an error), then the regular-file guard (nothing special
//! is ever opened), then the size refusal BEFORE the open, and only then the
//! bounded read.
//!
//! THE CAP IS HARD, AND PROVISIONAL: 96 MiB. `max_bytes` is the caller's ask,
//! the effective budget is the smaller of the two, and a file that is bigger is
//! refused without being read. The number is a hypothesis to be tested on real
//! documents (ADR-0035's consequence), not a rule.
//!
//! A REFUSAL IS TYPED DATA, and it never carries the path: the caller holds the
//! citation. The vocabulary is the head read's, plus the size refusal:
//! 'too-large', 'not-a-file', 'cannot-reach', 'escaped' and 'io'. 'escaped' is
//! this module's name for the pseudo-filesystem guard (the same guard `head.rs`
//! keeps, shared below), not the boundary layer's workspace escape — that
//! resolver stays in JS (ADR-0029 rule 1).

use std::fs;
use std::io::{self, Read};

use serde::Serialize;

use crate::head::is_pseudo_path;

/// The hard ceiling on one byte read (PROVISIONAL, story 16.4's cap): bigger
/// than any document this map reads, small enough that the webview is never
/// asked to hold a whole archive in memory.
pub const MAX_BYTES: usize = 96 * 1024 * 1024;

/// The byte read's typed refusal codes. The frontend maps ONE vocabulary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RefusalCode {
    /// The file is bigger than the effective budget: refused before opening.
    TooLarge,
    /// The path resolves to something that is not a regular file (a directory,
    /// a FIFO, a device): nothing special is opened.
    NotAFile,
    /// The path does not resolve at all (absent or dangling).
    CannotReach,
    /// The pseudo-filesystem guard: '/proc', '/sys' and '/dev' style entries are
    /// refused by name (shared with the head read's guard).
    Escaped,
    /// The filesystem's own error, in the OS's words.
    Io,
}

/// One typed refusal. It NEVER carries the path.
#[derive(Debug, Serialize)]
pub struct BytesRefusal {
    /// The typed code the frontend maps to one quiet sentence.
    pub code: RefusalCode,
    /// The OS's own words when there are any; never the path.
    pub detail: Option<String>,
}

impl BytesRefusal {
    fn with_detail(code: RefusalCode, detail: impl Into<String>) -> BytesRefusal {
        BytesRefusal {
            code,
            detail: Some(detail.into()),
        }
    }
}

/// Read one regular file's bytes, bounded by the caller's ask and the hard cap.
///
/// Order: pseudo-filesystem refusal, stat, regular-file guard, size refusal,
/// bounded read. Every refusal is a typed code; the frontend turns each into
/// one quiet sentence and writes nothing.
pub fn read(path: &str, max_bytes: usize) -> Result<Vec<u8>, BytesRefusal> {
    // Refused by name before anything is stat'ed or opened: a pseudo entry can
    // report as a regular file and still block or answer with kernel data.
    if is_pseudo_path(path) {
        return Err(BytesRefusal::with_detail(
            RefusalCode::Escaped,
            "a pseudo filesystem path",
        ));
    }

    let meta = match fs::metadata(path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            return Err(BytesRefusal::with_detail(
                RefusalCode::CannotReach,
                "no such file",
            ));
        }
        Err(e) => return Err(BytesRefusal::with_detail(RefusalCode::Io, e.to_string())),
    };
    if !meta.is_file() {
        return Err(BytesRefusal::with_detail(
            RefusalCode::NotAFile,
            "not a regular file",
        ));
    }

    // The caller's ask is bounded by the hard cap; a file past the budget is
    // refused BEFORE the open, so nothing large is ever read into memory.
    let budget = max_bytes.min(MAX_BYTES);
    if meta.len() > budget as u64 {
        return Err(BytesRefusal::with_detail(
            RefusalCode::TooLarge,
            "the file is larger than the budget",
        ));
    }

    // One byte of headroom so a file that GROWS between the stat and the read
    // is still caught by the length check below.
    let mut raw: Vec<u8> = Vec::new();
    let file = fs::File::open(path)
        .map_err(|e| BytesRefusal::with_detail(RefusalCode::Io, e.to_string()))?;
    io::BufReader::new(file)
        .take(budget as u64 + 1)
        .read_to_end(&mut raw)
        .map_err(|e| BytesRefusal::with_detail(RefusalCode::Io, e.to_string()))?;
    if raw.len() > budget {
        return Err(BytesRefusal::with_detail(
            RefusalCode::TooLarge,
            "the file is larger than the budget",
        ));
    }
    Ok(raw)
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
                "attentioneer-bytes-{}-{}",
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
    fn reads_a_small_file_whole() {
        let dir = TempDir::new();
        dir.file("f.pdf", b"%PDF-1.4\nbody\n");
        let bytes = read(&dir.str("f.pdf"), 1024).unwrap();
        assert_eq!(bytes, b"%PDF-1.4\nbody\n");
    }

    #[test]
    fn binary_bytes_are_returned_verbatim() {
        // The one reader that must NOT refuse a NUL byte: a PDF is binary.
        let dir = TempDir::new();
        let payload = [0x89u8, b'P', b'D', b'F', 0x00, 0xff, 0x0a];
        dir.file("f.pdf", &payload);
        assert_eq!(read(&dir.str("f.pdf"), 1024).unwrap(), payload);
    }

    #[test]
    fn an_exact_fit_is_read() {
        let dir = TempDir::new();
        dir.file("f.bin", b"12345678");
        assert_eq!(read(&dir.str("f.bin"), 8).unwrap().len(), 8);
    }

    #[test]
    fn the_budget_refuses_a_bigger_file_before_reading_it() {
        let dir = TempDir::new();
        dir.file("f.bin", b"0123456789");
        let refusal = read(&dir.str("f.bin"), 9).unwrap_err();
        assert_eq!(refusal.code, RefusalCode::TooLarge);
        assert_eq!(
            refusal.detail.as_deref(),
            Some("the file is larger than the budget")
        );
        assert!(!format!("{:?}", refusal).contains("f.bin"));
    }

    #[test]
    fn a_zero_budget_reads_only_an_empty_file() {
        let dir = TempDir::new();
        dir.file("empty.bin", b"");
        assert_eq!(read(&dir.str("empty.bin"), 0).unwrap(), Vec::<u8>::new());
        dir.file("one.bin", b"x");
        assert_eq!(
            read(&dir.str("one.bin"), 0).unwrap_err().code,
            RefusalCode::TooLarge
        );
    }

    #[test]
    fn the_hard_cap_wins_over_a_bigger_ask() {
        // A sparse file just past the hard cap: the size refusal comes from the
        // stat, so nothing is read (and the test writes no 96 MiB of bytes).
        let dir = TempDir::new();
        let path = dir.path.join("huge.bin");
        let file = fs::File::create(&path).unwrap();
        file.set_len(MAX_BYTES as u64 + 1).unwrap();
        drop(file);
        let refusal = read(&path.to_string_lossy(), usize::MAX).unwrap_err();
        assert_eq!(refusal.code, RefusalCode::TooLarge);
    }

    #[test]
    fn a_missing_file_refuses_cannot_reach() {
        let dir = TempDir::new();
        let refusal = read(&dir.str("gone.pdf"), 1024).unwrap_err();
        assert_eq!(refusal.code, RefusalCode::CannotReach);
        assert_eq!(refusal.detail.as_deref(), Some("no such file"));
        assert!(!format!("{:?}", refusal).contains("gone.pdf"));
    }

    #[test]
    fn a_directory_refuses_not_a_file() {
        let dir = TempDir::new();
        fs::create_dir_all(dir.path.join("sub")).unwrap();
        let refusal = read(&dir.str("sub"), 1024).unwrap_err();
        assert_eq!(refusal.code, RefusalCode::NotAFile);
        assert_eq!(refusal.detail.as_deref(), Some("not a regular file"));
        assert!(!format!("{:?}", refusal).contains("sub"));
    }

    #[test]
    fn pseudo_roots_are_refused_by_name() {
        // The same guard as the head read (one shared helper): an absolute
        // pseudo path is refused even when it does not exist here, and a
        // workspace directory that happens to be called "dev/" is ordinary.
        for path in ["/proc/self/status", "/sys/kernel", "/dev/null"] {
            let refusal = read(path, 1024).unwrap_err();
            assert_eq!(refusal.code, RefusalCode::Escaped, "{path}");
            assert!(!format!("{:?}", refusal).contains(path));
        }
        let dir = TempDir::new();
        fs::create_dir_all(dir.path.join("dev")).unwrap();
        dir.file("dev/x.pdf", b"%PDF");
        assert_eq!(read(&dir.str("dev/x.pdf"), 1024).unwrap(), b"%PDF");
    }

    #[test]
    fn an_io_failure_refuses_io_without_the_path() {
        let refusal = read("bad\0path.pdf", 1024).unwrap_err();
        assert_eq!(refusal.code, RefusalCode::Io);
        assert!(!format!("{:?}", refusal).contains("bad"));
    }

    #[test]
    fn the_refusal_codes_serialize_as_the_frontends_kebab_case() {
        for (code, expected) in [
            (RefusalCode::TooLarge, "too-large"),
            (RefusalCode::NotAFile, "not-a-file"),
            (RefusalCode::CannotReach, "cannot-reach"),
            (RefusalCode::Escaped, "escaped"),
            (RefusalCode::Io, "io"),
        ] {
            let refusal = BytesRefusal::with_detail(code, "x");
            let value: serde_json::Value = serde_json::to_value(&refusal).unwrap();
            assert_eq!(value["code"], expected);
            assert_eq!(value["detail"], "x");
        }
    }
}
