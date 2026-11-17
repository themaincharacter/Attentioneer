//! The external CLI tier's process layer (Epic 15 story 5; PROVISIONAL).
//!
//! WHY THIS IS IN RUST AND NOT THE SIDECAR: a CLI backend is a program, and
//! the host already owns process lifecycle for the turn (`sidecar.rs`). The
//! window hands over a command, the places to look for it and an ARGV ARRAY;
//! this module resolves, spawns without a shell, captures a capped output and
//! kills the child at the stated budget. It reads no workspace file and makes
//! no network call of its own — the child may, and that is the child's doing,
//! not the bridge's.
//!
//! WHY AN ARGV ARRAY AND NEVER A STRING: the prompt is ONE value built by the
//! window (`cli.ts`'s `buildCliArgs`), and this module never parses, splits or
//! quotes it. The one exception is Windows' command interpreter, needed to run
//! a `.cmd`/`.bat` shim: even there the program and its arguments cross as
//! separate entries to `cmd /C` — never one concatenated command line.
//!
//! WHY THE ORDER IS REPEATED: only this side can see a filesystem, so it
//! walks the same three steps the pure rules state — the path as typed, then
//! PATH, then a small well-known list — and REPORTS which one found it, so the
//! app can say it out loud. The order is one rule written twice, tested on
//! both sides.
//!
//! PROVISIONAL: the probe budget, the run budget, the output cap and the
//! well-known lists.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;

/// How long a version or sign-in probe may take before the child is killed.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(20);

/// How long a turn's child may run when the window states no budget.
pub const DEFAULT_RUN_TIMEOUT: Duration = Duration::from_secs(120);

/// The most stdout or stderr this bridge keeps, each; the rest is drained and
/// dropped. A CLI that prints a book should not become the window's memory.
pub const OUTPUT_CAP: usize = 256 * 1024;

/// The children a stop can still reach, by the token the window minted.
///
/// WHY A TOKEN AND NOT A PID: the window never sees or names a process. It
/// mints an opaque run id for the turn before the child exists and hands the
/// same id to `cli_run` and later to `cli_cancel`; only this module maps that
/// id to the running child, so a stop can kill exactly one child and no other.
fn running_children() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static RUNNING: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Register a child's stop flag BEFORE it spawns, so a click during the spawn
/// still lands on the child that is about to exist.
fn register_child(token: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut map) = running_children().lock() {
        map.insert(token.to_string(), flag.clone());
    }
    flag
}

/// The run is over (answered, failed or killed): its token stops naming it.
fn forget_child(token: &str) {
    if let Ok(mut map) = running_children().lock() {
        map.remove(token);
    }
}

/// Set one child's stop flag; true when a child was there to stop. False is
/// not an error — the child may have finished between the click and the call.
pub fn cancel_child(token: &str) -> bool {
    if let Ok(map) = running_children().lock() {
        if let Some(flag) = map.get(token) {
            flag.store(true, Ordering::SeqCst);
            return true;
        }
    }
    false
}

/// Is this token's child still running? (The test's window into the registry.)
#[cfg(test)]
fn child_registered(token: &str) -> bool {
    running_children()
        .lock()
        .map(|map| map.contains_key(token))
        .unwrap_or(false)
}

/// Where a command was found, and which step found it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliWhere {
    pub path: String,
    /// `typed-path` | `path` | `well-known` — the window words this.
    pub how: String,
}

/// What one run produced. `timed_out` means the child was killed, so `code`
/// is `None` rather than an invented exit status.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliFacts {
    pub path: String,
    pub how: String,
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    /// The child was killed because a stop named it — not a timeout.
    pub cancelled: bool,
}

/// Does the text name a path rather than a bare command?
fn looks_like_path(command: &str) -> bool {
    let text = command.trim();
    if text.is_empty() {
        return false;
    }
    if text == "~" || text.starts_with("~/") || text.starts_with("~\\") {
        return true;
    }
    if text.contains('/') || text.contains('\\') {
        return true;
    }
    cfg!(windows) && text.as_bytes().get(1) == Some(&b':')
}

/// The home directory, or `None` when the environment does not name one.
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Expand a leading `~` against the home directory.
fn expand_home(path: &str, home: Option<&Path>) -> PathBuf {
    let text = path.trim();
    if text == "~" {
        return home
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from(text));
    }
    if let Some(rest) = text.strip_prefix("~/").or_else(|| text.strip_prefix("~\\")) {
        if let Some(home) = home {
            return home.join(rest);
        }
    }
    PathBuf::from(text)
}

/// The executable names to try in one directory (Windows hides extensions).
fn executable_names(command: &str, windows: bool) -> Vec<String> {
    let text = command.trim().to_string();
    if !windows {
        return vec![text];
    }
    let has_extension = text
        .rsplit_once('.')
        .map(|(_, ext)| !ext.is_empty() && ext.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or(false);
    if has_extension {
        return vec![text];
    }
    vec![
        text.clone(),
        format!("{text}.exe"),
        format!("{text}.cmd"),
        format!("{text}.bat"),
    ]
}

/// The small well-known list, after PATH. Mirrors `cli.ts`'s defaults.
fn default_well_known(home: Option<&Path>, windows: bool) -> Vec<PathBuf> {
    let mut places = Vec::new();
    if windows {
        if let Some(home) = home {
            places.push(home.join("AppData").join("Roaming").join("npm"));
            places.push(home.join(".local").join("bin"));
        }
        return places;
    }
    if let Some(home) = home {
        places.push(home.join(".local").join("bin"));
    }
    places.push(PathBuf::from("/usr/local/bin"));
    places.push(PathBuf::from("/opt/homebrew/bin"));
    places
}

/// Resolution against explicit inputs — the pure half, so a test can stand a
/// fake filesystem in front of it.
pub fn resolve_in(
    command: &str,
    path_dirs: &[PathBuf],
    home: Option<&Path>,
    extra_well_known: &[String],
) -> Result<CliWhere, String> {
    let text = command.trim();
    if text.is_empty() {
        return Err("a CLI provider needs a command to run".to_string());
    }
    let windows = cfg!(windows);
    let not_found = || {
        format!("{text} was not found: not at that path, not on PATH, and not in the usual places")
    };

    // 1. The path the person typed. A typed path is used as typed: guessing a
    //    bare name's PATH after it would quietly run a different program.
    if looks_like_path(text) {
        let typed = expand_home(text, home);
        if typed.is_file() {
            return Ok(CliWhere {
                path: typed.display().to_string(),
                how: "typed-path".to_string(),
            });
        }
        return Err(not_found());
    }

    let names = executable_names(text, windows);
    let mut found: Option<(PathBuf, &'static str)> = None;

    // 2. PATH, in its own order.
    'path: for dir in path_dirs {
        for name in &names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                found = Some((candidate, "path"));
                break 'path;
            }
        }
    }

    // 3. The spec's own places, then the small default list.
    if found.is_none() {
        let places = extra_well_known
            .iter()
            .map(|place| expand_home(place, home))
            .chain(default_well_known(home, windows));
        'places: for dir in places {
            for name in &names {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    found = Some((candidate, "well-known"));
                    break 'places;
                }
            }
        }
    }

    match found {
        Some((path, how)) => Ok(CliWhere {
            path: path.display().to_string(),
            how: how.to_string(),
        }),
        None => Err(not_found()),
    }
}

/// Resolution against this machine's environment.
pub fn resolve(command: &str, extra_well_known: &[String]) -> Result<CliWhere, String> {
    let path_dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).collect())
        .unwrap_or_default();
    let home = home_dir();
    resolve_in(command, &path_dirs, home.as_deref(), extra_well_known)
}

/// The program to spawn and the entries that precede the caller's argv. A
/// Windows shim goes through the command interpreter — with its path as its
/// own entry, never spliced into a string.
fn shim_target(path: &Path, windows: bool) -> (PathBuf, Vec<std::ffi::OsString>) {
    if windows {
        let shim = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "cmd" | "bat" | "com"))
            .unwrap_or(false);
        if shim {
            return (
                PathBuf::from("cmd"),
                vec![
                    std::ffi::OsString::from("/C"),
                    path.as_os_str().to_os_string(),
                ],
            );
        }
    }
    (path.to_path_buf(), Vec::new())
}

/// Read a stream to its end, keeping at most `OUTPUT_CAP` bytes. The rest is
/// drained so a chatty child is never blocked on a full pipe.
fn read_capped<R: Read>(stream: Option<R>) -> (String, bool) {
    let Some(mut stream) = stream else {
        return (String::new(), false);
    };
    let mut kept: Vec<u8> = Vec::new();
    let mut buffer = [0u8; 8192];
    let mut cut = false;
    loop {
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                let room = OUTPUT_CAP.saturating_sub(kept.len());
                let take = read.min(room);
                kept.extend_from_slice(&buffer[..take]);
                if take < read {
                    cut = true;
                }
            }
            Err(_) => break,
        }
    }
    (String::from_utf8_lossy(&kept).into_owned(), cut)
}

/// Spawn, wait at most `timeout`, and kill the child when the budget runs out.
/// (The tests drive this door; the turn itself passes a stop flag.)
#[cfg(test)]
fn run_resolved(where_: &CliWhere, args: &[String], timeout: Duration) -> Result<CliFacts, String> {
    run_resolved_cancellable(where_, args, timeout, None)
}

/// The same run, with a stop flag: when it is set the child is KILLED at once
/// and the facts say `cancelled`, never `timed_out`.
fn run_resolved_cancellable(
    where_: &CliWhere,
    args: &[String],
    timeout: Duration,
    cancel: Option<&AtomicBool>,
) -> Result<CliFacts, String> {
    let path = PathBuf::from(&where_.path);
    let (program, prefix) = shim_target(&path, cfg!(windows));

    let mut command = Command::new(&program);
    command
        .args(prefix)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("{} could not start: {error}", where_.path))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    // The readers report over channels rather than being joined: a killed
    // child's GRANDCHILDREN may still hold the pipe open, and a turn that has
    // already given up must not wait for them to finish.
    let (out_tx, out_rx) = std::sync::mpsc::channel();
    let (err_tx, err_rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = out_tx.send(read_capped(stdout));
    });
    std::thread::spawn(move || {
        let _ = err_tx.send(read_capped(stderr));
    });

    let deadline = Instant::now() + timeout;
    let mut timed_out = false;
    let mut cancelled = false;
    let code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) => {
                // A stop outranks the budget: somebody wants this child gone
                // now, so it is killed and the facts say why.
                if cancel.map(|flag| flag.load(Ordering::SeqCst)).unwrap_or(false) {
                    cancelled = true;
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                if Instant::now() >= deadline {
                    // The budget ran out: the child is KILLED, not left running
                    // behind a turn that already gave up on it.
                    timed_out = true;
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };

    // A short grace after the child is gone; a timeout's leftovers get none.
    let grace = Duration::from_millis(500);
    let (stdout, stdout_cut) = out_rx
        .recv_timeout(grace)
        .unwrap_or_else(|_| (String::new(), false));
    let (stderr, stderr_cut) = err_rx
        .recv_timeout(grace)
        .unwrap_or_else(|_| (String::new(), false));
    // A cut is stated in the one place a person reads the stream's end: the
    // bridge does not silently pretend the child said less than it did.
    let stdout = if stdout_cut {
        stdout + "\n[the output was cut at 256 KiB]"
    } else {
        stdout
    };
    let stderr = if stderr_cut {
        stderr + "\n[the output was cut at 256 KiB]"
    } else {
        stderr
    };

    Ok(CliFacts {
        path: where_.path.clone(),
        how: where_.how.clone(),
        code,
        stdout,
        stderr,
        timed_out,
        cancelled,
    })
}

/// Resolve, then run. The shared body of the probe and the turn.
pub fn run_command(
    command: &str,
    extra_well_known: &[String],
    args: &[String],
    timeout: Duration,
) -> Result<CliFacts, String> {
    run_command_cancellable(command, extra_well_known, args, timeout, None)
}

/// Resolve, then run, with a stop flag reaching the child.
fn run_command_cancellable(
    command: &str,
    extra_well_known: &[String],
    args: &[String],
    timeout: Duration,
    cancel: Option<&AtomicBool>,
) -> Result<CliFacts, String> {
    let found = resolve(command, extra_well_known)?;
    run_resolved_cancellable(&found, args, timeout, cancel)
}

/// Where a command resolves, without running anything.
#[tauri::command]
pub fn cli_where(command: String, well_known: Option<Vec<String>>) -> Result<CliWhere, String> {
    resolve(&command, &well_known.unwrap_or_default())
}

/// The version or sign-in probe: one argv, the probe budget.
#[tauri::command]
pub fn cli_probe(
    command: String,
    well_known: Option<Vec<String>>,
    args: Vec<String>,
) -> Result<CliFacts, String> {
    run_command(
        &command,
        &well_known.unwrap_or_default(),
        &args,
        PROBE_TIMEOUT,
    )
}

/// One turn through a CLI: one argv, the stated budget, killed at the end.
///
/// `run_id` is the turn's stop token. The child is registered under it before
/// it spawns and forgotten however the run ends, so a later stop can never hit
/// a finished run's token by accident.
#[tauri::command]
pub fn cli_run(
    command: String,
    well_known: Option<Vec<String>>,
    args: Vec<String>,
    timeout_ms: Option<u64>,
    run_id: Option<String>,
) -> Result<CliFacts, String> {
    let timeout = timeout_ms
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_RUN_TIMEOUT);
    let cancel = run_id.as_deref().map(register_child);
    let outcome = run_command_cancellable(
        &command,
        &well_known.unwrap_or_default(),
        &args,
        timeout,
        cancel.as_deref(),
    );
    if let Some(token) = run_id.as_deref() {
        forget_child(token);
    }
    outcome
}

/// Kill the one CLI child running under this token (story 7's stop).
#[tauri::command]
pub fn cli_cancel(run_id: String) -> Result<bool, String> {
    Ok(cancel_child(&run_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("attentioneer-cli-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("a temp dir");
        dir
    }

    #[cfg(unix)]
    fn write_script(dir: &Path, name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join(name);
        std::fs::write(&path, body).expect("the script");
        let mut permissions = std::fs::metadata(&path)
            .expect("its metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&path, permissions).expect("its mode");
        path
    }

    /// The typed path wins over anything of the same name on PATH or in the
    /// usual places, and the answer SAYS which step found it.
    #[test]
    fn resolution_uses_the_typed_path_first() {
        let typed_dir = temp_dir("typed");
        let typed = write_script(&typed_dir, "thinking", "#!/bin/sh\nexit 0\n");
        let result = resolve_in(
            &typed.display().to_string(),
            &[PathBuf::from("/usr/bin")],
            None,
            &[],
        )
        .expect("the typed path exists");
        assert_eq!(result.how, "typed-path");
        assert_eq!(result.path, typed.display().to_string());
    }

    /// A typed path that names nothing is a refusal, never a quiet search for
    /// a same-named program somewhere else.
    #[test]
    fn a_missing_typed_path_is_not_guessed_around() {
        let dir = temp_dir("missing-typed");
        let error = resolve_in(
            &dir.join("absent").display().to_string(),
            &[dir.clone()],
            None,
            &[],
        )
        .expect_err("nothing is there");
        assert!(error.contains("was not found"), "{error}");
    }

    /// PATH before the well-known list, and the label tells the truth.
    #[test]
    fn resolution_walks_path_before_the_usual_places() {
        let path_dir = temp_dir("path-step");
        let on_path = write_script(&path_dir, "thinking", "#!/bin/sh\nexit 0\n");
        let found =
            resolve_in("thinking", &[path_dir.clone()], Some(&path_dir), &[]).expect("on PATH");
        assert_eq!(found.how, "path");
        assert_eq!(found.path, on_path.display().to_string());

        // Remove it from PATH: the well-known list still finds it, and says so.
        std::fs::remove_file(&on_path).expect("remove");
        let known_dir = path_dir.join("usual");
        std::fs::create_dir_all(&known_dir).expect("a dir");
        let known = write_script(&known_dir, "thinking", "#!/bin/sh\nexit 0\n");
        let found = resolve_in(
            "thinking",
            &[],
            Some(&path_dir),
            &[known_dir.display().to_string()],
        )
        .expect("in the usual places");
        assert_eq!(found.how, "well-known");
        assert_eq!(found.path, known.display().to_string());

        let error = resolve_in("thinking", &[], Some(&path_dir), &[]).expect_err("nowhere now");
        assert!(error.contains("thinking"), "{error}");
    }

    /// A Windows shim crosses to the command interpreter as its OWN entry; on
    /// other platforms the program is the shim itself (a test can see both).
    #[test]
    fn a_shim_goes_through_the_interpreter_with_separate_entries() {
        let shim = Path::new("tools").join("thinking.cmd");
        let (program, prefix) = shim_target(&shim, true);
        assert_eq!(program, PathBuf::from("cmd"));
        assert_eq!(prefix.len(), 2);
        assert_eq!(prefix[0], std::ffi::OsString::from("/C"));
        assert_eq!(prefix[1], shim.as_os_str());

        let (program, prefix) = shim_target(&shim, false);
        assert_eq!(program, shim);
        assert!(prefix.is_empty());

        let real = Path::new("/usr/local/bin/thinking");
        let (program, prefix) = shim_target(real, true);
        assert_eq!(program, real);
        assert!(prefix.is_empty());
    }

    /// The prompt is ONE argv entry: spaces and quotes stay inside it.
    #[cfg(unix)]
    #[test]
    fn one_prompt_stays_one_argv_entry() {
        let dir = temp_dir("one-argv");
        let script = write_script(
            &dir,
            "thinking",
            r#"#!/bin/sh
printf 'arg1=[%s]
' "$1"
printf 'count=[%s]
' "$#"
"#,
        );
        let facts = run_resolved(
            &CliWhere {
                path: script.display().to_string(),
                how: "typed-path".to_string(),
            },
            &[String::from("two words \"and quotes\"")],
            Duration::from_secs(10),
        )
        .expect("it runs");
        assert_eq!(facts.code, Some(0));
        assert!(
            facts.stdout.contains("arg1=[two words \"and quotes\"]"),
            "{}",
            facts.stdout
        );
        assert!(facts.stdout.contains("count=[1]"), "{}", facts.stdout);
    }

    /// A non-zero exit keeps the code and the stderr the turn will quote.
    #[cfg(unix)]
    #[test]
    fn a_failed_run_keeps_the_code_and_stderr() {
        let dir = temp_dir("failure");
        let script = write_script(
            &dir,
            "thinking",
            "#!/bin/sh\necho the first line >&2\necho the second line >&2\nexit 3\n",
        );
        let facts = run_resolved(
            &CliWhere {
                path: script.display().to_string(),
                how: "typed-path".to_string(),
            },
            &[],
            Duration::from_secs(10),
        )
        .expect("it runs");
        assert_eq!(facts.code, Some(3));
        assert!(facts.stderr.contains("the first line"));
        assert!(facts.stderr.contains("the second line"));
        assert!(!facts.timed_out);
    }

    /// The budget kills the child: `timed_out` is stated and the call returns
    /// promptly rather than waiting for the child to finish.
    #[cfg(unix)]
    #[test]
    fn a_timeout_kills_the_child() {
        let dir = temp_dir("timeout");
        let script = write_script(&dir, "thinking", "#!/bin/sh\nsleep 30\n");
        let started = Instant::now();
        let facts = run_resolved(
            &CliWhere {
                path: script.display().to_string(),
                how: "typed-path".to_string(),
            },
            &[],
            Duration::from_millis(300),
        )
        .expect("it runs");
        assert!(facts.timed_out);
        assert_eq!(facts.code, None);
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    /// A stop kills a REAL child: a temp script that sleeps 30 seconds is gone
    /// promptly, the facts say `cancelled` (not a timeout), and its token is
    /// forgotten. This is the story's "prove stop kills a CLI child" proof.
    #[cfg(unix)]
    #[test]
    fn a_stop_kills_the_child() {
        let dir = temp_dir("stop");
        let script = write_script(&dir, "thinking", "#!/bin/sh\nsleep 30\n");
        let token = format!("stop-{}", std::process::id());
        let path = script.display().to_string();
        let started = Instant::now();
        let worker = {
            let token = token.clone();
            std::thread::spawn(move || {
                cli_run(path, None, Vec::new(), Some(30_000), Some(token))
            })
        };
        // The child registers before it spawns: wait for that so the stop names
        // a child that exists rather than racing the spawn.
        let deadline = Instant::now() + Duration::from_secs(5);
        while !child_registered(&token) {
            assert!(Instant::now() < deadline, "the child never registered");
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(cancel_child(&token), "the stop reached the child");
        let facts = worker
            .join()
            .expect("the run returns")
            .expect("it runs");
        assert!(facts.cancelled, "it was stopped, not timed out");
        assert!(!facts.timed_out);
        assert_eq!(facts.code, None);
        assert!(started.elapsed() < Duration::from_secs(10));
        assert!(!child_registered(&token), "the token is forgotten");
    }
}
