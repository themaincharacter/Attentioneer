//! The window's bounded head-of-file read (Epic 5 story 2, ADR-0017's
//! amendment; the research's "cheapest sound approach"), grown by Epic 12
//! story 1 with a DECODE STATUS and TYPED refusal codes (ADR-0029).
//!
//! read_text_head returns a SMALL glimpse of a text file: a bounded head, cut
//! on a UTF-8 char boundary, plus the identity facts the window shows first
//! (exists, size, mtime) and the DECODE STATUS — `clean` when the bytes were
//! valid UTF-8, `with-replacement` when the lossy decoder had to replace stray
//! bytes. The replacement is SAID now, never silent (ADR-0029 rule 5). It is
//! READ-ONLY BY CONSTRUCTION: the module contains no writer, no remove and no
//! rename, so "an outward read must never write" is a property of the code, not
//! of discipline.
//!
//! THE HEAD IS A TRANSIENT; THE LOG IS THE PRISM. The older doc said "nothing
//! here is stored anywhere"; that is CORRECTED in place (ADR-0028's
//! consequences). The WINDOW still stores nothing — it is a snapshot of the
//! open moment — but the contact Move that read through it leaves a PRISM record
//! (`map/prisms.jsonl`): the pointer cited by its natural key, the outcome, the
//! exact bounds asked for and this decode status. The PRISM never carries the
//! head's BYTES; the log is structural facts, and memory prose is the kept
//! response's only home.
//!
//! THE REACH IS ARBITRARY PATHS, AND THAT IS A CONVENTION BOUNDARY, NOT
//! ENFORCEMENT. App-registered Tauri commands are not gated or scoped by the
//! capability system (the research's section 2.3), so this command reads
//! whatever path the pointer names: inside the workspace, an authored absolute
//! 'at', or anywhere else the process can read. The boundary is ONE JS layer
//! (ADR-0029 rule 1): the contact layer's pure resolver refuses `..` and
//! symlink escapes at the point of origin, and the Rust-side guard is the
//! NAMED DEBT — this bridge is unscoped by design, and says so. The only guard
//! here is structural, not a policy: regular files only (stat first:
//! directories, FIFOs, sockets, devices and /proc, /sys, /dev-style pseudo
//! files are refused), bounded memory, and a bounded byte/line budget.
//! Resolution follows the filesystem as written; the command never trims,
//! repairs or interprets the authored path (World B).
//!
//! A REFUSAL IS TYPED DATA, never a sentence with the path baked in: the path
//! is the caller's CITATION business (the PRISM cites the pointer's natural
//! key, ADR-0029 rule 2), so a refusal carries a code and, at most, the OS's
//! own words. The codes are `not-text`, `cannot-reach`, `escaped` and `io`;
//! `escaped` is the boundary layer's refusal in the SAME vocabulary — this
//! unscoped read never answers it, and it never pretends to.
//!
//! Provisional: the binary guard (a NUL byte means "not text"), the pseudo
//! filesystem refusal, the decode status' spelling and the refusal codes'
//! spelling.

use std::fs;
use std::io::{self, Read};
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// Whether the head's bytes decoded cleanly or were rewritten by the lossy
/// decoder (Epic 12 story 1). Shared with the contact layer's PRISM log.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DecodeStatus {
    /// Valid UTF-8 all the way through the returned prefix.
    Clean,
    /// At least one invalid byte sequence was replaced (U+FFFD) in the prefix.
    WithReplacement,
}

/// The head read's typed refusal codes (Epic 12 story 1, ADR-0029). The
/// vocabulary is ONE for the contact layer: `escaped` is answered by the JS
/// boundary resolver, the other three by this read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RefusalCode {
    /// A NUL byte: the bytes are not text, so they are refused, not rendered.
    NotText,
    /// The path is not a regular file (a directory, FIFO, device, pseudo root)
    /// or could not be resolved to one.
    CannotReach,
    /// The boundary layer refused the path as outside the workspace root. This
    /// read never emits it (the read is unscoped): the frontend's resolver
    /// answers `escaped` itself, and the code is part of the SHARED vocabulary
    /// so both sides map ONE set. The Rust constructor below is kept for the
    /// vocabulary's tests and for the day the read is handed a root.
    #[allow(dead_code)]
    Escaped,
    /// The filesystem's own error, in the OS's words.
    Io,
}

/// One typed refusal. It NEVER carries the path: the path is the caller's
/// citation business (the PRISM cites the pointer, never a verbatim path).
#[derive(Debug, Serialize)]
pub struct HeadRefusal {
    /// The typed code the frontend maps.
    pub code: RefusalCode,
    /// The OS's own words when there are any; never the path.
    pub detail: Option<String>,
}

#[allow(dead_code)] // `new`/`escaped`: the escaped code is the boundary's
impl HeadRefusal {
    fn new(code: RefusalCode) -> HeadRefusal {
        HeadRefusal { code, detail: None }
    }

    fn with_detail(code: RefusalCode, detail: impl Into<String>) -> HeadRefusal {
        HeadRefusal {
            code,
            detail: Some(detail.into()),
        }
    }

    /// The boundary layer's refusal, in the one vocabulary (never emitted by
    /// this unscoped read; the contact layer's resolver answers it).
    pub fn escaped() -> HeadRefusal {
        HeadRefusal::new(RefusalCode::Escaped)
    }
}

/// One bounded glimpse of a text file. Every field is display data; the
/// WINDOW stores nothing (it is a snapshot of the open moment). What the Move
/// leaves behind is the PRISM record: the pointer, the outcome, the exact
/// bounds and this decode status — never the head's bytes.
#[derive(Debug, Serialize)]
pub struct TextHead {
    /// The readable prefix: bounded by lines AND bytes, cut on a char
    /// boundary, so it is always valid UTF-8 text at its edges (stray invalid
    /// bytes inside it are replaced, and `decode` says so).
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
    /// Whether the returned prefix decoded cleanly or needed replacement.
    pub decode: DecodeStatus,
}

impl TextHead {
    fn absent() -> TextHead {
        TextHead {
            head: String::new(),
            truncated: false,
            exists: false,
            size: None,
            mtime: None,
            decode: DecodeStatus::Clean,
        }
    }
}

/// Read at most max_lines lines and max_bytes bytes of a regular text file.
///
/// Order of the guards, deliberately: stat first (a missing path is an honest
/// "absent", not an error), then the regular-file guard (nothing special is
/// ever opened), then the bounded read, then the binary guard and the bounds.
/// Every refusal is a TYPED code (never a free string with the path in it); the
/// frontend turns each into the same quiet "cannot read".
pub fn read(path: &str, max_lines: usize, max_bytes: usize) -> Result<TextHead, HeadRefusal> {
    // Stat first: never open a directory, a FIFO or a device.
    let meta = match fs::metadata(path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(TextHead::absent()),
        Err(e) => return Err(HeadRefusal::with_detail(RefusalCode::Io, e.to_string())),
    };
    if !meta.is_file() || is_pseudo_path(path) {
        return Err(HeadRefusal::with_detail(
            RefusalCode::CannotReach,
            "not a regular file",
        ));
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
            decode: DecodeStatus::Clean,
        });
    }

    // The byte cap short-circuits the read: one extra byte tells us whether the
    // file goes on, so a 400 MB log costs at most max_bytes + 1 bytes here.
    let budget = (max_bytes as u64).saturating_add(1);
    let mut raw: Vec<u8> = Vec::new();
    let file = fs::File::open(path)
        .map_err(|e| HeadRefusal::with_detail(RefusalCode::Io, e.to_string()))?;
    io::BufReader::new(file)
        .take(budget)
        .read_to_end(&mut raw)
        .map_err(|e| HeadRefusal::with_detail(RefusalCode::Io, e.to_string()))?;

    // A NUL byte means the head is not text: refuse rather than render bytes as
    // replacement characters. Provisional (the research's "cannot preview").
    if raw.contains(&0) {
        return Err(HeadRefusal::with_detail(
            RefusalCode::NotText,
            "not a text file",
        ));
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

    // THE DECODE STATUS (Epic 12 story 1): from_utf8_lossy still decodes, but
    // the replacement is now FLAGGED rather than swallowed.
    let slice = &raw[..end];
    let decode = if std::str::from_utf8(slice).is_ok() {
        DecodeStatus::Clean
    } else {
        DecodeStatus::WithReplacement
    };

    Ok(TextHead {
        head: String::from_utf8_lossy(slice).into_owned(),
        truncated: byte_truncated || line_truncated,
        exists: true,
        size: Some(size),
        mtime,
        decode,
    })
}

/// The /proc, /sys and /dev style pseudo filesystems: their entries can report
/// as regular files while reading may block or answer with kernel data.
/// Refused by name, before anything is opened. A convention guard, like the
/// reach itself: it keeps a glimpse from blocking, it does not sandbox reads.
///
/// Shared with the byte read (story 16.4, `bytes.rs`): ONE guard, so the two
/// reads can never drift apart on which roots are special.
pub(crate) fn is_pseudo_path(path: &str) -> bool {
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
        assert_eq!(text.decode, DecodeStatus::Clean);
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
        assert_eq!(text.decode, DecodeStatus::Clean);
    }

    #[test]
    fn the_byte_cap_short_circuits_and_says_truncated() {
        let bytes = vec![b'a'; 5000];
        let text = head_of(&bytes, 400, 10);
        assert_eq!(text.head, "aaaaaaaaaa");
        assert!(text.truncated);
        // The stat identity is the whole file's, not the head's.
        assert_eq!(text.size, Some(5000));
        assert_eq!(text.decode, DecodeStatus::Clean);
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
        assert_eq!(text.decode, DecodeStatus::Clean);

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
    fn invalid_utf8_without_a_nul_is_decoded_lossily_and_flagged() {
        let text = head_of(&[0xff, b'a', b'\n'], 10, 100);
        assert!(text.head.contains('a'));
        assert!(text.head.contains('\u{FFFD}'));
        assert!(text.exists);
        // Epic 12 story 1: the lossy decode is SAID, not silent.
        assert_eq!(text.decode, DecodeStatus::WithReplacement);
    }

    #[test]
    fn valid_text_says_clean() {
        let text = head_of("plain é€𝄞\n".as_bytes(), 10, 100);
        assert_eq!(text.decode, DecodeStatus::Clean);
        assert!(!text.head.contains('\u{FFFD}'));
    }

    #[test]
    fn a_binary_head_is_refused_not_rendered() {
        let dir = TempDir::new();
        dir.file("f.bin", &[0x89, b'P', b'N', b'G', 0x00, 0x01]);
        let refusal = read(&dir.str("f.bin"), 10, 100).unwrap_err();
        assert_eq!(refusal.code, RefusalCode::NotText);
        assert_eq!(
            refusal.detail.as_deref(),
            Some("not a text file"),
            "the code carries the reason; the path does not travel"
        );
        assert!(!format!("{:?}", refusal).contains("f.bin"));
    }

    #[test]
    fn a_directory_refuses_cannot_reach() {
        let dir = TempDir::new();
        fs::create_dir_all(dir.path.join("sub")).unwrap();
        let refusal = read(&dir.str("sub"), 10, 100).unwrap_err();
        assert_eq!(refusal.code, RefusalCode::CannotReach);
        assert_eq!(refusal.detail.as_deref(), Some("not a regular file"));
        assert!(!format!("{:?}", refusal).contains("sub"));
    }

    #[test]
    fn an_io_failure_refuses_io_without_the_path() {
        // A NUL byte inside the path is not a path: the OS refuses the call.
        let refusal = read("bad\0path.txt", 10, 100).unwrap_err();
        assert_eq!(refusal.code, RefusalCode::Io);
        assert!(!format!("{:?}", refusal).contains("bad"));
    }

    #[test]
    fn escaped_is_the_boundary_layers_code_in_the_same_vocabulary() {
        // The unscoped read never answers this: the contact layer's resolver
        // does. It is the SAME typed vocabulary, so the frontend maps one set.
        let refusal = HeadRefusal::escaped();
        assert_eq!(refusal.code, RefusalCode::Escaped);
        assert_eq!(refusal.detail, None);
        assert_eq!(
            serde_json::to_string(&refusal).unwrap(),
            r#"{"code":"escaped","detail":null}"#
        );
    }

    #[test]
    fn the_refusal_codes_serialize_as_the_frontends_kebab_case() {
        for (code, expected) in [
            (RefusalCode::NotText, "not-text"),
            (RefusalCode::CannotReach, "cannot-reach"),
            (RefusalCode::Escaped, "escaped"),
            (RefusalCode::Io, "io"),
        ] {
            let refusal = HeadRefusal::new(code);
            let value: serde_json::Value = serde_json::to_value(&refusal).unwrap();
            assert_eq!(value["code"], expected);
            assert_eq!(value["detail"], serde_json::Value::Null);
        }
    }

    #[test]
    fn the_decode_status_serializes_as_the_frontends_kebab_case() {
        assert_eq!(
            serde_json::to_string(&DecodeStatus::Clean).unwrap(),
            r#""clean""#
        );
        assert_eq!(
            serde_json::to_string(&DecodeStatus::WithReplacement).unwrap(),
            r#""with-replacement""#
        );
    }

    #[test]
    fn zero_bounds_return_an_empty_head() {
        let text = head_of(b"anything\n", 0, 100);
        assert_eq!(text.head, "");
        assert!(text.truncated);
        assert!(text.exists);
        assert_eq!(text.decode, DecodeStatus::Clean);
    }

    #[cfg(unix)]
    #[test]
    fn devices_and_pseudo_files_are_refused_before_reading() {
        if Path::new("/dev/null").exists() {
            let refusal = read("/dev/null", 10, 100).unwrap_err();
            assert_eq!(refusal.code, RefusalCode::CannotReach);
        }
        if Path::new("/proc/self/status").exists() {
            let refusal = read("/proc/self/status", 10, 100).unwrap_err();
            assert_eq!(refusal.code, RefusalCode::CannotReach);
        }
        if Path::new("/sys/kernel").exists() {
            let refusal = read("/sys/kernel", 10, 100).unwrap_err();
            assert_eq!(refusal.code, RefusalCode::CannotReach);
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
        let refusal = read(&fifo.to_string_lossy(), 10, 100).unwrap_err();
        assert_eq!(refusal.code, RefusalCode::CannotReach);
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
