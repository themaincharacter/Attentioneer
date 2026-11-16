//! The boundary layer's realpath primitive (Epic 12 story 1, ADR-0029).
//!
//! `canonicalize` answers the contact layer's one question: what does this
//! path REALLY name? Symlinks and `..` are followed by the filesystem, and a
//! target that does not exist is canonicalized AS FAR AS IT EXISTS — the
//! deepest existing ancestor is canonicalized, its (nonexistent) missing tail is
//! appended VERBATIM and then normalized lexically (no symlink can live in a
//! nonexistent tail), so a not-yet-created artifact still resolves.
//!
//! THE ROOT IS NOT THIS MODULE'S BUSINESS, deliberately. This command refuses
//! nothing on scope grounds and knows no workspace root: the CALLER compares
//! the answer with the root and refuses `escaped` (the pure resolver in
//! `contacts/boundary.ts`). That is ADR-0029 rule 1's one-layer honesty — the
//! Rust bridge stays UNSCOPED, and the Rust-side guard is the named debt.
//! Canonicalizing here is not a scope check; it is the raw material the check
//! is made of.
//!
//! The refusal is typed and NEVER carries the path (the caller holds the
//! citation): today the only code is `io`, for a filesystem error that is not
//! a missing component.
//!
//! Provisional: the command's name, the refusal code's spelling and the
//! missing-tail rule.

use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

/// The canonicalization's typed refusal codes (PROVISIONAL: one code today).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PathRefusalCode {
    /// The filesystem failed for a reason that is not a missing component, or
    /// the path has no existing ancestor at all.
    Io,
}

/// One typed refusal. It NEVER carries the path: the path is the caller's
/// citation business (the PRISM cites the pointer). The detail is the OS's own
/// words, when there are any.
#[derive(Debug, Serialize)]
pub struct PathRefusal {
    /// The typed code the frontend maps.
    pub code: PathRefusalCode,
    /// A short description from the OS, never the path.
    pub detail: String,
}

impl PathRefusal {
    fn io(detail: impl Into<String>) -> PathRefusal {
        PathRefusal {
            code: PathRefusalCode::Io,
            detail: detail.into(),
        }
    }
}

/// Canonicalize a path as far as it exists.
///
/// The walk: try the whole path; on NotFound, drop its last component onto a
/// tail and try the parent; repeat until something canonicalizes. The
/// canonical ancestor is then extended with the tail (restored to path order)
/// and normalized lexically. NotFound is the ONLY error that continues the walk
/// — a permission error is a real IO refusal, never a silent "missing".
pub fn canonicalize(path: &str) -> Result<String, PathRefusal> {
    let mut current = PathBuf::from(path);
    let mut missing: Vec<OsString> = Vec::new();
    loop {
        match fs::canonicalize(&current) {
            Ok(resolved) => {
                let mut full = resolved;
                for part in missing.iter().rev() {
                    full.push(part);
                }
                return Ok(normalize(&full).to_string_lossy().into_owned());
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                // Pop the LAST COMPONENT, not the last file name: a path may
                // end in `..` (which `file_name` refuses to name), and the
                // missing tail must keep that component so the lexical
                // normalization below can see the climb.
                match current.components().next_back() {
                    Some(Component::Normal(name)) => missing.push(name.to_os_string()),
                    Some(Component::ParentDir) => missing.push(OsString::from("..")),
                    Some(Component::CurDir) => {}
                    _ => return Err(PathRefusal::io("no existing ancestor")),
                }
                match current.parent() {
                    Some(parent) if !parent.as_os_str().is_empty() => {
                        current = parent.to_path_buf();
                    }
                    _ => {
                        // No existing ancestor at all: a relative path with no
                        // existing prefix, or a filesystem root that is gone.
                        return Err(PathRefusal::io("no existing ancestor"));
                    }
                }
            }
            Err(e) => return Err(PathRefusal::io(e.to_string())),
        }
    }
}

/// Resolve `.` and `..` lexically, clamping at the filesystem root. The
/// canonicalized ancestor has no such components; only the appended missing
/// tail can, and that tail names nothing that exists, so a lexical answer is
/// the honest one there.
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => out.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            Component::Normal(part) => out.push(part),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::UNIX_EPOCH;

    /// A unique temp directory, removed on drop (no new dependency for a test).
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new() -> TempDir {
            let mut path = std::env::temp_dir();
            let unique = format!(
                "attentioneer-paths-{}-{}",
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

        fn canonical(&self) -> PathBuf {
            fs::canonicalize(&self.path).unwrap()
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

    fn resolve(path: &str) -> String {
        canonicalize(path).unwrap()
    }

    #[test]
    fn an_existing_file_is_fully_canonicalized() {
        let dir = TempDir::new();
        fs::write(dir.path.join("x.md"), b"# x\n").unwrap();
        let resolved = resolve(&dir.str("x.md"));
        assert_eq!(Path::new(&resolved), dir.canonical().join("x.md"));
    }

    #[test]
    fn the_root_itself_canonicalizes() {
        let dir = TempDir::new();
        assert_eq!(Path::new(&resolve(&dir.str(""))), dir.canonical());
    }

    #[test]
    fn a_missing_target_keeps_its_tail_from_the_deepest_existing_ancestor() {
        let dir = TempDir::new();
        fs::create_dir_all(dir.path.join("notes")).unwrap();
        let resolved = resolve(&dir.str("notes/missing.txt"));
        assert_eq!(
            Path::new(&resolved),
            dir.canonical().join("notes").join("missing.txt")
        );
        // The intermediate folder need not exist either.
        let nested = resolve(&dir.str("new/deeper/missing.txt"));
        assert_eq!(
            Path::new(&nested),
            dir.canonical()
                .join("new")
                .join("deeper")
                .join("missing.txt")
        );
    }

    #[test]
    fn dot_dot_inside_the_root_stays_inside() {
        let dir = TempDir::new();
        fs::create_dir_all(dir.path.join("notes")).unwrap();
        fs::write(dir.path.join("x.md"), b"x").unwrap();
        let resolved = resolve(&dir.str("notes/../x.md"));
        assert_eq!(Path::new(&resolved), dir.canonical().join("x.md"));
    }

    #[test]
    fn dot_dot_that_leaves_the_root_resolves_outside_it() {
        let dir = TempDir::new();
        fs::create_dir_all(dir.path.join("inside")).unwrap();
        // The caller checks the root; this command honestly answers the truth.
        let escaped = resolve(&dir.str("inside/../../.."));
        assert!(!escaped.starts_with(&dir.canonical().to_string_lossy().into_owned()));
    }

    #[test]
    fn a_missing_tail_with_dot_dot_cannot_smuggle_an_escape_past_a_prefix_check() {
        let dir = TempDir::new();
        // "gone" does not exist, so the tail is normalized lexically: the
        // answer must NOT read as inside the root with a hidden climb.
        let resolved = resolve(&dir.str("gone/../../outside/file.txt"));
        assert!(
            !resolved.starts_with(&dir.canonical().to_string_lossy().into_owned()),
            "{}",
            resolved
        );
        assert!(resolved.ends_with("outside/file.txt"), "{}", resolved);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_target_is_followed() {
        let dir = TempDir::new();
        let outside = TempDir::new();
        std::os::unix::fs::symlink(&outside.path, dir.path.join("link")).unwrap();
        let resolved = resolve(&dir.str("link/inside.txt"));
        assert_eq!(Path::new(&resolved), outside.canonical().join("inside.txt"));
        // The caller's prefix check is what refuses this as escaped.
        assert!(!resolved.starts_with(&dir.canonical().to_string_lossy().into_owned()));
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_inside_still_resolves_inside() {
        let dir = TempDir::new();
        fs::create_dir_all(dir.path.join("real")).unwrap();
        fs::write(dir.path.join("real").join("x.md"), b"x").unwrap();
        std::os::unix::fs::symlink(dir.path.join("real"), dir.path.join("link")).unwrap();
        let resolved = resolve(&dir.str("link/x.md"));
        assert_eq!(
            Path::new(&resolved),
            dir.canonical().join("real").join("x.md")
        );
    }

    #[test]
    fn a_path_through_a_file_refuses_io_not_a_missing_walk() {
        let dir = TempDir::new();
        fs::write(dir.path.join("file.txt"), b"x").unwrap();
        let refusal = canonicalize(&dir.str("file.txt/under.txt")).unwrap_err();
        assert_eq!(refusal.code, PathRefusalCode::Io);
        assert!(!format!("{:?}", refusal).contains("file.txt"));
    }

    #[test]
    fn a_relative_path_with_no_existing_prefix_refuses_io() {
        let refusal = canonicalize("no-such-relative/further").unwrap_err();
        assert_eq!(refusal.code, PathRefusalCode::Io);
    }
}
