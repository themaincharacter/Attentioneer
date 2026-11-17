//! The turn's sidecar (Epic 15 story 1; ADR-0034): one Bun child, over stdio,
//! owned by the app.
//!
//! WHY A CHILD AT ALL: the provider adapters, the stream vocabulary and (later)
//! the CLI tier are JavaScript; ADR-0034 buys them by shipping one runtime
//! instead of re-implementing them in Rust. The seam is deliberately narrow —
//! this module only spawns, pipes lines and kills, so a Rust implementation
//! could replace the child without the map, the packet or the ghost envelope
//! noticing.
//!
//! WHY STDIO: ADR-0034 forbids a listening socket. The child's only inbound
//! channel is its parent's pipe, and its only outbound network call is the
//! provider POST it makes itself. Nothing here reads a workspace file either:
//! the host hands over request lines, not paths.
//!
//! WHY THE KEY IS NEVER HERE: the key travels inside the request line the
//! WINDOW builds (from its own session memory) and crosses this pipe to the
//! child for the length of one turn. Rust never parses it, never stores it and
//! never logs it. The OS-keychain story is still to come (story 4; its ADR is
//! not written yet) — until then a key lives in the window's memory only.
//!
//! PROVISIONAL: the five-second health budget, the event name `sidecar-line`,
//! the resolution order for Bun and the entry, and the sentence wording. A
//! compiled sidecar binary is a LATER story; today the child is always the dev
//! entry and the status says so.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// How long the child has to say `hello` before the start is called a failure
/// (PROVISIONAL). Five seconds is generous for a local Bun process and short
/// enough that the panel is never left hanging on a broken install.
pub const HEALTH_BUDGET: Duration = Duration::from_secs(5);

/// The event the window listens to: one line of the wire, verbatim.
const LINE_EVENT: &str = "sidecar-line";

/// What `sidecar_status` answers. The window uses `running` to know whether a
/// turn will need a spawn, and reports the resolution only as diagnosis — the
/// panel never shows a path.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStatus {
    pub running: bool,
    /// The entry this host runs (the dev `sidecar/main.ts` today).
    pub entry: String,
    /// `"dev-entry"` today; `"compiled"` is a later story.
    pub entry_kind: String,
    /// The Bun executable, as resolved (env var or PATH).
    pub bun: String,
}

/// The child's hello gate: the stdout thread sets it, `sidecar_start` waits on
/// it, so "healthy" is a fact about the pipe rather than a sleep's guess.
struct HelloGate {
    ready: Mutex<bool>,
    signal: Condvar,
}

struct Inner {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    status: Option<SidecarStatus>,
    hello: Arc<HelloGate>,
}

/// The one managed state (ADR-0034 decision 3): the child and its pipe. Drop
/// kills the child, so quitting the app never leaves a sidecar behind.
pub struct SidecarState {
    inner: Mutex<Inner>,
}

impl Default for SidecarState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner {
                child: None,
                stdin: None,
                status: None,
                hello: Arc::new(HelloGate {
                    ready: Mutex::new(false),
                    signal: Condvar::new(),
                }),
            }),
        }
    }
}

impl SidecarState {
    /// Close the pipe and kill the child, if one is alive. Called on app exit
    /// AND from `Drop` — the exit hook is the honest one (Tauri may end the
    /// process without unwinding a state), `Drop` is the belt-and-braces.
    pub fn kill(&self) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        // Dropping stdin first gives the child its EOF, so a child that is
        // only waiting to be let go exits on its own.
        inner.stdin = None;
        if let Some(mut child) = inner.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        inner.status = None;
    }
}

impl Drop for SidecarState {
    fn drop(&mut self) {
        self.kill();
    }
}

/// One line's framing: a line must stay a line. An embedded newline would
/// split the envelope in two and confuse the reader on the other end, so the
/// window's send refuses it instead.
fn line_is_single(line: &str) -> bool {
    !line.contains('\n') && !line.contains('\r')
}

/// Is this the child's hello? Read from the wire (not from a byte offset):
/// the story's first line is `{"kind":"hello","version":1}`, and the health
/// gate is the only place Rust interprets the envelope.
fn is_hello(line: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(line)
        .ok()
        .and_then(|value| value.get("kind").and_then(|kind| kind.as_str()).map(str::to_owned))
        .as_deref()
        == Some("hello")
}

/// Resolve the Bun executable: `REA_TURN_BUN` first, then `bun` on PATH. A set
/// env var that names nothing is a refusal, not a silent fallback — the panel
/// can then say which one was wrong.
fn resolve_bun() -> Result<PathBuf, String> {
    if let Ok(raw) = std::env::var("REA_TURN_BUN") {
        let path = PathBuf::from(&raw);
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!(
            "the turn sidecar's Bun was not found at {}",
            path.display()
        ));
    }
    if let Some(found) = find_on_path("bun") {
        return Ok(found);
    }
    Err("the turn sidecar needs Bun: set REA_TURN_BUN or put bun on PATH".to_string())
}

fn find_on_path(name: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    let mut candidates = vec![name.to_string()];
    if cfg!(windows) {
        candidates.push(format!("{name}.exe"));
    }
    for dir in std::env::split_paths(&paths) {
        for candidate in &candidates {
            let full = dir.join(candidate);
            if full.is_file() {
                return Some(full);
            }
        }
    }
    None
}

/// Resolve the entry the child runs. Today that is ALWAYS the dev entry: the
/// crate's own place in the tree names `sidecar/main.ts`, and a run started
/// from elsewhere walks up from its working directory. `REA_TURN_SIDECAR_ENTRY`
/// is the escape hatch (tests, and later a compiled binary).
fn resolve_entry() -> Result<(PathBuf, &'static str), String> {
    if let Ok(raw) = std::env::var("REA_TURN_SIDECAR_ENTRY") {
        let path = PathBuf::from(&raw);
        if path.is_file() {
            return Ok((path, "dev-entry"));
        }
        return Err(format!(
            "the turn sidecar's entry is not there: {}",
            path.display()
        ));
    }
    // The crate sits at `app/src-tauri`; the entry is its sibling's.
    if let Some(app_dir) = Path::new(env!("CARGO_MANIFEST_DIR")).parent() {
        let dev = app_dir.join("sidecar").join("main.ts");
        if dev.is_file() {
            return Ok((dev, "dev-entry"));
        }
    }
    // A `tauri dev` run from some other directory: walk up to the tree.
    if let Ok(cwd) = std::env::current_dir() {
        for base in cwd.ancestors() {
            for candidate in [
                base.join("sidecar").join("main.ts"),
                base.join("app").join("sidecar").join("main.ts"),
            ] {
                if candidate.is_file() {
                    return Ok((candidate, "dev-entry"));
                }
            }
        }
    }
    Err("the turn sidecar's entry (sidecar/main.ts) was not found beside the app".to_string())
}

/// Forward the child's stdout to the window, line by line, and open the hello
/// gate on the first `hello`. Nothing here parses the key or the answer: the
/// window owns the wire (PROVISIONAL, story 1).
fn pipe_lines(app: AppHandle, stdout: ChildStdout, hello: Arc<HelloGate>) {
    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else {
            break;
        };
        if line.trim().is_empty() {
            continue;
        }
        if is_hello(&line) {
            if let Ok(mut ready) = hello.ready.lock() {
                *ready = true;
                hello.signal.notify_all();
            }
        }
        // One event per line: the window's parser decides what it means.
        let _ = app.emit(LINE_EVENT, line);
    }
    // stdout closed: the child is gone. The status command notices on its next
    // call (try_wait), and the next turn spawns a fresh one.
}

/// Wait (bounded) for the hello gate. `true` = the child spoke the wire.
fn wait_for_hello(gate: &HelloGate, budget: Duration) -> bool {
    let deadline = Instant::now() + budget;
    let Ok(mut ready) = gate.ready.lock() else {
        return false;
    };
    while !*ready {
        let now = Instant::now();
        if now >= deadline {
            return false;
        }
        let remaining = deadline - now;
        ready = match gate.signal.wait_timeout(ready, remaining) {
            Ok((guard, _)) => guard,
            Err(poisoned) => poisoned.into_inner().0,
        };
    }
    true
}

/// Spawn (or reuse) the child and prove it is alive. Runs on the async
/// runtime so the five-second budget never freezes the window. All of the work
/// is blocking, but bounded: a Mutex twice and one condvar wait.
#[tauri::command]
pub async fn sidecar_start(
    app: AppHandle,
    state: tauri::State<'_, SidecarState>,
) -> Result<SidecarStatus, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "the turn sidecar's lock was poisoned".to_string())?;

    // A living child is reused: a second turn does not spawn a second process.
    if let Some(child) = inner.child.as_mut() {
        if matches!(child.try_wait(), Ok(None)) {
            if let Some(status) = inner.status.clone() {
                return Ok(status);
            }
        } else {
            inner.child = None;
            inner.stdin = None;
            inner.status = None;
        }
    }

    let bun = resolve_bun()?;
    let (entry, entry_kind) = resolve_entry()?;

    let mut command = Command::new(&bun);
    command
        .arg(&entry)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        // stderr is dropped: the child says everything the app needs on the
        // wire, and a provider's error text must never be mistaken for a line.
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("the turn sidecar could not start: {error}"))?;
    let stdout = child.stdout.take();
    let stdin = child.stdin.take();

    let gate = Arc::new(HelloGate {
        ready: Mutex::new(false),
        signal: Condvar::new(),
    });
    inner.child = Some(child);
    inner.stdin = stdin;
    inner.hello = gate.clone();

    if let Some(out) = stdout {
        let handle = app.clone();
        std::thread::spawn(move || pipe_lines(handle, out, gate));
    }

    if !wait_for_hello(&inner.hello, HEALTH_BUDGET) {
        inner.stdin = None;
        if let Some(mut child) = inner.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        return Err("the turn sidecar started but never said hello within five seconds".to_string());
    }

    let status = SidecarStatus {
        running: true,
        entry: entry.display().to_string(),
        entry_kind: entry_kind.to_string(),
        bun: bun.display().to_string(),
    };
    inner.status = Some(status.clone());
    Ok(status)
}

/// Write one request line to the child. A line with an embedded newline is
/// refused here (framing, not policy); a stopped child is one sentence.
#[tauri::command]
pub fn sidecar_send(
    state: tauri::State<'_, SidecarState>,
    line: String,
) -> Result<(), String> {
    if !line_is_single(&line) {
        return Err("a sidecar line must stay on one line".to_string());
    }
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "the turn sidecar's lock was poisoned".to_string())?;
    let stdin = inner
        .stdin
        .as_mut()
        .ok_or_else(|| "the turn sidecar is not running".to_string())?;
    stdin
        .write_all(line.as_bytes())
        .and_then(|()| stdin.write_all(b"\n"))
        .and_then(|()| stdin.flush())
        .map_err(|error| format!("the turn sidecar's pipe refused a line: {error}"))
}

/// The child's state, without spawning anything. `None` means no child was
/// ever started; `Some(running: false)` means it started and has since died,
/// so the panel can say so instead of pretending the turn will work.
#[tauri::command]
pub fn sidecar_status(
    state: tauri::State<'_, SidecarState>,
) -> Result<Option<SidecarStatus>, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "the turn sidecar's lock was poisoned".to_string())?;
    let Some(status) = inner.status.clone() else {
        return Ok(None);
    };
    let alive = match inner.child.as_mut() {
        Some(child) => matches!(child.try_wait(), Ok(None)),
        None => false,
    };
    if !alive {
        inner.child = None;
        inner.stdin = None;
        inner.status = None;
    }
    Ok(Some(SidecarStatus {
        running: alive,
        ..status
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The dev entry is resolved from the crate's own place in the tree, so a
    /// `tauri dev` run never needs a configured path (the compiled binary is a
    /// later story).
    #[test]
    fn the_dev_entry_is_found_beside_the_crate() {
        let (entry, kind) = resolve_entry().expect("the sidecar entry sits in the tree");
        assert_eq!(kind, "dev-entry");
        assert!(entry.ends_with(Path::new("sidecar").join("main.ts")));
    }

    /// Health is a fact about the wire: only the child's own hello opens the
    /// gate, and an older/other line never does.
    #[test]
    fn hello_is_read_from_the_wire_not_guessed() {
        assert!(is_hello("{\"kind\":\"hello\",\"version\":1}"));
        assert!(!is_hello("{\"id\":1,\"kind\":\"done\"}"));
        assert!(!is_hello("not json"));
    }

    /// Framing: a line is a line, so an embedded newline is refused rather
    /// than split into two envelopes.
    #[test]
    fn a_line_carries_no_newline() {
        assert!(line_is_single("{\"id\":1,\"kind\":\"stop\"}"));
        assert!(!line_is_single("a\nb"));
        assert!(!line_is_single("a\rb"));
    }
}
