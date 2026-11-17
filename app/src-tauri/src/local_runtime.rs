//! The local runtime tier's process layer (Epic 15 story 6; PROVISIONAL).
//!
//! WHY THIS IS IN RUST AND NOT THE SIDECAR: the story's seam table puts the
//! process here. A model that runs on this machine is one long-lived child,
//! and the host already owns process lifecycle for the turn (sidecar.rs). The
//! window hands over a command, a model path and an ARGV ARRAY; this module
//! chooses a loopback port, mints one key for THIS launch, substitutes the
//! placeholders into separate argv entries, spawns without a shell, waits for
//! readiness under a stated budget, and kills the child when it has been idle.
//! The window then makes the ordinary HTTP turn against
//! http://127.0.0.1:<port>/v1, so no sidecar change is needed.
//!
//! WHAT NEVER HAPPENS HERE: this module never listens on a socket. The port is
//! chosen by binding an ephemeral port and closing it again; the only connect
//! it makes is its own readiness probe to the port it just handed over. The
//! key is minted into this process's memory for that child only: it is never
//! written to disk, never logged, and never allowed into an error sentence
//! (the child's last line is scrubbed before it can be shown).
//!
//! WHY ARGV AND NEVER A STRING: each placeholder replaces text inside ONE
//! already-separate argv entry. A model path with spaces stays one entry; a
//! shell never sees any of it.
//!
//! PROVISIONAL: the readiness budget (30 s), the default idle rule (10
//! minutes), the status fields and the sentence wording.

use std::io::{BufRead, BufReader, Read};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

/// How long the child has to prove it is serving before the start is called a
/// failure (PROVISIONAL). Thirty seconds covers a small model's load on a
/// laptop without leaving the panel hanging on a command that will never be
/// ready.
pub const READINESS_BUDGET: Duration = Duration::from_secs(30);

/// The idle window when the row does not state one (PROVISIONAL).
pub const DEFAULT_IDLE_MINUTES: u64 = 10;

/// How often the idle supervisor looks, and how often the readiness loop does.
const TICK: Duration = Duration::from_millis(100);
const READY_TICK: Duration = Duration::from_millis(25);

/// The most of the child's last output line this module keeps, so a chatty
/// command cannot become the window's memory.
const LAST_LINE_CAP: usize = 400;

/// What local_start / local_status answer. The key rides this answer ONLY so
/// the window can put it in one request line; nothing here persists it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalStatus {
    pub running: bool,
    /// The loopback port this launch chose, when one is running.
    pub port: Option<u16>,
    /// The per-launch key, in memory for this child only.
    pub key: Option<String>,
    /// How many idle minutes the row stated (the supervisor's rule).
    pub idle_minutes: u64,
    /// The row this child belongs to, so a second row replaces the first.
    pub tag: String,
    /// The child's last output line, as a reading (never a log line).
    pub last_line: String,
}

/// One started child, as the tests need it (the command returns its status).
#[derive(Debug)]
pub struct Started {
    pub status: LocalStatus,
    /// The direct child's pid; the tests prove the kill with it.
    #[allow(dead_code)]
    pub pid: u32,
}

struct Inner {
    child: Option<Child>,
    pid: Option<u32>,
    tag: String,
    command: String,
    /// command + model + argv, so an EDIT to any of them is a new launch.
    template: String,
    port: u16,
    key: String,
    /// The row's idle rule, kept exactly as stated so a test's short window is
    /// the window it asked for (the status reports it in minutes).
    idle: Duration,
    idle_minutes: u64,
    last_line: Arc<Mutex<String>>,
    last_used: Instant,
    generation: u64,
}

impl Inner {
    fn empty() -> Self {
        Self {
            child: None,
            pid: None,
            tag: String::new(),
            command: String::new(),
            template: String::new(),
            port: 0,
            key: String::new(),
            idle: Duration::from_secs(DEFAULT_IDLE_MINUTES * 60),
            idle_minutes: DEFAULT_IDLE_MINUTES,
            last_line: Arc::new(Mutex::new(String::new())),
            last_used: Instant::now(),
            generation: 0,
        }
    }

    /// Kill and reap whatever is here, and forget it. The caller holds the lock.
    fn take_child(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.pid = None;
        self.port = 0;
        self.key.clear();
        self.tag.clear();
        self.command.clear();
        self.template.clear();
        self.last_line = Arc::new(Mutex::new(String::new()));
    }
}

/// The one managed state: the child and the facts that belong to THIS launch.
/// Drop kills it, so quitting the app never leaves a model server behind.
pub struct LocalRuntimeState {
    inner: Arc<Mutex<Inner>>,
    next_generation: Arc<AtomicU64>,
}

impl Default for LocalRuntimeState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner::empty())),
            next_generation: Arc::new(AtomicU64::new(1)),
        }
    }
}

impl LocalRuntimeState {
    /// Kill the child and let any supervisor notice. Called on app exit AND
    /// from Drop -- the exit hook is the honest one, Drop is the belt.
    pub fn kill(&self) {
        self.next_generation.fetch_add(1, Ordering::SeqCst);
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        inner.take_child();
        inner.generation = self.next_generation.fetch_add(1, Ordering::SeqCst) + 1;
    }

    /// The child's state without starting anything. None means nothing is
    /// running (never started, already stopped, or died on its own).
    pub fn status(&self) -> Option<LocalStatus> {
        let Ok(mut inner) = self.inner.lock() else {
            return None;
        };
        status_of(&mut inner)
    }
}

impl Drop for LocalRuntimeState {
    fn drop(&mut self) {
        self.kill();
    }
}

fn status_of(inner: &mut Inner) -> Option<LocalStatus> {
    let alive = match inner.child.as_mut() {
        Some(child) => matches!(child.try_wait(), Ok(None)),
        None => false,
    };
    if !alive {
        inner.take_child();
        return None;
    }
    Some(LocalStatus {
        running: true,
        port: Some(inner.port),
        key: Some(inner.key.clone()),
        idle_minutes: inner.idle_minutes,
        tag: inner.tag.clone(),
        last_line: line_of(&inner.last_line),
    })
}

fn line_of(last: &Arc<Mutex<String>>) -> String {
    last.lock().map(|line| line.clone()).unwrap_or_default()
}

/// Substitute the placeholders into the argv, ENTRY BY ENTRY. Each entry is
/// still exactly one argument after substitution: a model path with spaces in
/// it stays inside its own entry, and no shell is ever asked to split it.
pub fn substitute_args(args: &[String], port: u16, key: &str, model: &str) -> Vec<String> {
    let port_text = port.to_string();
    args.iter()
        .map(|arg| {
            arg.replace("{port}", &port_text)
                .replace("{key}", key)
                .replace("{model}", model)
        })
        .collect()
}

/// Choose a loopback port by binding ephemeral and closing again. A race is a
/// start failure (the readiness probe will notice), never a retry loop.
pub fn choose_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("a loopback port could not be chosen: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("the chosen port could not be read: {error}"))?
        .port();
    drop(listener);
    Ok(port)
}

/// Does the loopback port answer a connect? The readiness rule's second half;
/// the probe only ever connects to the port this module chose.
pub fn port_answers(port: u16) -> bool {
    let address = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&address, Duration::from_millis(50)).is_ok()
}

fn hex(bytes: &[u8]) -> String {
    let mut text = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        text.push_str(&format!("{byte:02x}"));
    }
    text
}

/// Mint one key for THIS launch. Random bytes from the OS when it hands them
/// over; the fallback is still per-launch and unique enough to be a gate. The
/// value never leaves memory except as the child's argv entry and the turn's
/// request line.
pub fn mint_key() -> String {
    let mut bytes = [0u8; 24];
    #[cfg(unix)]
    {
        if let Ok(mut source) = std::fs::File::open("/dev/urandom") {
            if source.read_exact(&mut bytes).is_ok() {
                return format!("sk-local-{}", hex(&bytes));
            }
        }
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    format!("sk-local-{nanos:x}-{:x}", std::process::id())
}

/// Read one child stream to its end, keeping only the last non-empty line and
/// opening the readiness gate when the stated pattern appears. The key is
/// scrubbed here too: a child that echoes its own argv must not hand the key
/// back into an error sentence.
fn pump<R: Read>(
    stream: R,
    last: Arc<Mutex<String>>,
    key: String,
    ready_pattern: Option<String>,
    ready: Arc<AtomicBool>,
) {
    let mut reader = BufReader::new(stream);
    let mut buffer = Vec::new();
    loop {
        buffer.clear();
        match reader.read_until(b'\n', &mut buffer) {
            Ok(0) => return,
            Ok(_) => {}
            Err(_) => return,
        }
        let raw = String::from_utf8_lossy(&buffer);
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let line = if key.is_empty() {
            line.to_string()
        } else {
            line.replace(&key, "[the key]")
        };
        let line: String = line.chars().take(LAST_LINE_CAP).collect();
        if let Ok(mut held) = last.lock() {
            *held = line.clone();
        }
        if let Some(pattern) = ready_pattern.as_deref() {
            if line.to_lowercase().contains(&pattern.to_lowercase()) {
                ready.store(true, Ordering::SeqCst);
            }
        }
    }
}

/// The idle supervisor: after the row's idle window with no touch, the child is
/// KILLED. It holds only a generation number, so a later launch's child is
/// never the one this loop stops.
fn supervise(inner: Arc<Mutex<Inner>>, generation: u64) {
    loop {
        std::thread::sleep(TICK);
        let Ok(mut guard) = inner.lock() else {
            return;
        };
        if guard.generation != generation {
            return;
        }
        let idle = guard.idle;
        // A child that died on its own is cleared, not reported as running.
        let dead = match guard.child.as_mut() {
            Some(child) => matches!(child.try_wait(), Ok(Some(_))),
            None => true,
        };
        if dead {
            guard.take_child();
            guard.generation = generation.wrapping_add(1);
            return;
        }
        if guard.last_used.elapsed() >= idle {
            guard.take_child();
            guard.generation = generation.wrapping_add(1);
            return;
        }
    }
}

/// The scrubbed tail of the child's output, for a failure sentence: the key is
/// never allowed into an error, and a child that said nothing is said plainly.
fn said_last_line(inner_last: &Arc<Mutex<String>>, key: &str) -> String {
    let mut line = line_of(inner_last);
    if !key.is_empty() {
        line = line.replace(key, "[the key]");
    }
    let line = line.trim();
    if line.is_empty() {
        "it said nothing".to_string()
    } else {
        format!("it last said: {line}")
    }
}

/// Start (or reuse) one child against explicit inputs -- the half the tests
/// drive with a short budget and a temp script.
pub fn start_with(
    runtime: &LocalRuntimeState,
    tag: &str,
    command: &str,
    args: &[String],
    model: &str,
    ready_pattern: Option<&str>,
    idle: Duration,
    budget: Duration,
) -> Result<Started, String> {
    let command = command.trim();
    if command.is_empty() {
        return Err("a local provider needs a command to run".to_string());
    }
    let tag = tag.trim();
    let template = format!("{command}\n{model}\n{}", args.join("\u{1f}"));

    // A live child for the SAME row and the SAME template is reused: a turn's
    // start and its send are one launch, and a touch is all a second turn owes
    // the idle timer. An edited row is a different launch, not a stale child.
    {
        let mut inner = runtime
            .inner
            .lock()
            .map_err(|_| "the local runtime's lock was poisoned".to_string())?;
        if inner.child.is_some()
            && inner.tag == tag
            && inner.command == command
            && inner.template == template
        {
            inner.last_used = Instant::now();
            inner.idle = idle;
            inner.idle_minutes = idle.as_secs() / 60;
            if let Some(status) = status_of(&mut inner) {
                if let Some(pid) = inner.pid {
                    return Ok(Started { status, pid });
                }
            }
        }
        inner.take_child();
    }

    let port = choose_port()?;
    let key = mint_key();
    let argv = substitute_args(args, port, &key, model);

    let mut process = Command::new(command);
    process
        .args(&argv)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        process.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = process
        .spawn()
        .map_err(|error| format!("the local command could not start: {error}"))?;
    let pid = child.id();
    let last = Arc::new(Mutex::new(String::new()));
    let ready = Arc::new(AtomicBool::new(false));

    if let Some(stdout) = child.stdout.take() {
        let held = last.clone();
        let gate = ready.clone();
        let key = key.clone();
        let pattern = ready_pattern.map(str::to_string);
        std::thread::spawn(move || pump(stdout, held, key, pattern, gate));
    }
    if let Some(stderr) = child.stderr.take() {
        let held = last.clone();
        let gate = ready.clone();
        let key = key.clone();
        let pattern = ready_pattern.map(str::to_string);
        std::thread::spawn(move || pump(stderr, held, key, pattern, gate));
    }

    // Readiness: the stated pattern in the child's output, OR a successful TCP
    // connect to the port this launch chose. Both are bounded by ONE budget.
    let started_at = Instant::now();
    let mut exit_code: Option<Option<i32>> = None;
    loop {
        if ready.load(Ordering::SeqCst) || port_answers(port) {
            break;
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                exit_code = Some(status.code());
                break;
            }
            Ok(None) => {}
            Err(_) => {
                exit_code = Some(None);
                break;
            }
        }
        if started_at.elapsed() >= budget {
            break;
        }
        std::thread::sleep(READY_TICK);
    }

    if let Some(code) = exit_code {
        let _ = child.kill();
        let _ = child.wait();
        let code = match code {
            Some(code) => format!(" (exit {code})"),
            None => String::new(),
        };
        return Err(format!(
            "the local command exited before it was ready{code}; {}",
            said_last_line(&last, &key)
        ));
    }
    if !(ready.load(Ordering::SeqCst) || port_answers(port)) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!(
            "the local command did not become ready within {} seconds; {}",
            budget.as_secs(),
            said_last_line(&last, &key)
        ));
    }

    let generation = runtime.next_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let idle_minutes = idle.as_secs() / 60;
    {
        let mut inner = runtime
            .inner
            .lock()
            .map_err(|_| "the local runtime's lock was poisoned".to_string())?;
        inner.child = Some(child);
        inner.pid = Some(pid);
        inner.tag = tag.to_string();
        inner.command = command.to_string();
        inner.template = template;
        inner.port = port;
        inner.key = key.clone();
        inner.idle = idle;
        inner.idle_minutes = idle_minutes;
        inner.last_line = last.clone();
        inner.last_used = Instant::now();
        inner.generation = generation;
        let status = status_of(&mut inner)
            .ok_or_else(|| "the local command exited as soon as it was ready".to_string())?;
        let supervisor_inner = runtime.inner.clone();
        std::thread::spawn(move || supervise(supervisor_inner, generation));
        return Ok(Started { status, pid });
    }
}

/// The command the window calls. The idle rule arrives in minutes (the row's
/// unit) and a zero is read as one minute, so a child is never immortal.
#[tauri::command]
pub fn local_start(
    state: tauri::State<'_, LocalRuntimeState>,
    tag: String,
    command: String,
    args: Vec<String>,
    model: String,
    ready_pattern: Option<String>,
    idle_minutes: Option<u64>,
) -> Result<LocalStatus, String> {
    let minutes = idle_minutes.unwrap_or(DEFAULT_IDLE_MINUTES).max(1);
    start_with(
        &state,
        &tag,
        &command,
        &args,
        &model,
        ready_pattern.as_deref(),
        Duration::from_secs(minutes.saturating_mul(60)),
        READINESS_BUDGET,
    )
    .map(|started| started.status)
}

/// The child's state, without starting anything.
#[tauri::command]
pub fn local_status(state: tauri::State<'_, LocalRuntimeState>) -> Option<LocalStatus> {
    state.status()
}

/// Stop the child now (the panel's stop, and the idle rule's same kill).
#[tauri::command]
pub fn local_stop(state: tauri::State<'_, LocalRuntimeState>) {
    state.kill();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "attentioneer-local-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("a temp dir");
        dir
    }

    #[cfg(unix)]
    fn write_script(dir: &Path, name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join(name);
        std::fs::write(&path, body).expect("the script");
        let mut permissions = std::fs::metadata(&path).expect("its metadata").permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&path, permissions).expect("its mode");
        path
    }

    fn wait_until(mut done: impl FnMut() -> bool, budget: Duration) -> bool {
        let deadline = Instant::now() + budget;
        while Instant::now() < deadline {
            if done() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        done()
    }

    #[cfg(unix)]
    fn process_runs(pid: u32) -> bool {
        Path::new("/proc").join(pid.to_string()).exists()
    }

    /// THE HARD CONSTRAINT: placeholders go into SEPARATE argv entries. A model
    /// path with spaces in it is still exactly one argument.
    #[test]
    fn substitution_keeps_a_model_path_with_spaces_in_one_entry() {
        let args = vec![
            "-m".to_string(),
            "{model}".to_string(),
            "--host".to_string(),
            "127.0.0.1".to_string(),
            "--port".to_string(),
            "{port}".to_string(),
            "--api-key".to_string(),
            "{key}".to_string(),
        ];
        let argv = substitute_args(
            &args,
            51234,
            "sk-local-abc",
            "/home/me/my models/qwen 7b.gguf",
        );
        assert_eq!(argv.len(), 8);
        assert_eq!(argv[1], "/home/me/my models/qwen 7b.gguf");
        assert_eq!(argv[5], "51234");
        assert_eq!(argv[7], "sk-local-abc");
        // The placeholder really is gone: a later join by anything else could
        // not reintroduce a split entry.
        assert!(!argv.iter().any(|entry| entry.contains('{')));
    }

    /// The port is one the OS hands over on loopback, and it is free again
    /// after the choice: the app never keeps a listening socket.
    #[test]
    fn the_port_is_chosen_by_binding_and_closing() {
        let port = choose_port().expect("a loopback port");
        assert!(port > 0);
        let bound = TcpListener::bind(("127.0.0.1", port));
        assert!(bound.is_ok(), "the chosen port must be free afterwards");
    }

    /// A key is minted for one launch and looks like a key.
    #[test]
    fn a_key_is_minted_per_launch() {
        let first = mint_key();
        let second = mint_key();
        assert!(first.starts_with("sk-local-"));
        assert!(first.len() > 20);
        assert_ne!(first, second);
    }

    /// The readiness probe answers only for a port that is actually serving;
    /// it CONNECTS, it never listens.
    #[test]
    fn the_readiness_probe_connects_to_a_serving_port() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("a port");
        let port = listener.local_addr().expect("its address").port();
        assert!(port_answers(port));
        drop(listener);
    }

    /// A REAL temp stub script proves start, readiness, the chosen port and the
    /// minted key through the real spawn path.
    #[cfg(unix)]
    #[test]
    fn a_stub_server_becomes_ready_with_a_port_and_a_key() {
        let dir = temp_dir("ready");
        let script = write_script(
            &dir,
            "stub-server",
            "#!/bin/sh\necho 'the stub is ready on a loopback port'\nexec sleep 30.11\n",
        );
        let runtime = LocalRuntimeState::default();
        let started = start_with(
            &runtime,
            "stub",
            &script.display().to_string(),
            &[],
            "",
            Some("the stub is ready"),
            Duration::from_secs(60),
            Duration::from_secs(5),
        )
        .expect("the stub starts");
        assert!(started.status.running);
        assert!(started.status.port.unwrap_or(0) > 0);
        let key = started.status.key.clone().expect("a key for this launch");
        assert!(key.starts_with("sk-local-"));
        assert_eq!(started.status.tag, "stub");
        assert!(process_runs(started.pid));

        // The same row's second start REUSES the child (start and send are one
        // launch) and returns the same key.
        let again = start_with(
            &runtime,
            "stub",
            &script.display().to_string(),
            &[],
            "",
            Some("the stub is ready"),
            Duration::from_secs(60),
            Duration::from_secs(5),
        )
        .expect("reused");
        assert_eq!(again.status.key, Some(key));
        assert_eq!(again.pid, started.pid);

        runtime.kill();
        assert!(wait_until(|| !process_runs(started.pid), Duration::from_secs(3)));
    }

    /// THE IDLE-KILL: after the idle window with no turn, the child is gone.
    #[cfg(unix)]
    #[test]
    fn an_idle_child_is_killed() {
        let dir = temp_dir("idle");
        let script = write_script(
            &dir,
            "stub-server",
            "#!/bin/sh\necho 'the stub is ready'\nexec sleep 30.12\n",
        );
        let runtime = LocalRuntimeState::default();
        let started = start_with(
            &runtime,
            "stub",
            &script.display().to_string(),
            &[],
            "",
            Some("the stub is ready"),
            Duration::from_millis(400),
            Duration::from_secs(5),
        )
        .expect("the stub starts");
        assert!(process_runs(started.pid));
        assert!(
            wait_until(|| !process_runs(started.pid), Duration::from_secs(5)),
            "the idle supervisor must kill the child"
        );
        assert!(runtime.status().is_none());
    }

    /// QUITTING LEAVES NONE: dropping the state kills the child.
    #[cfg(unix)]
    #[test]
    fn dropping_the_state_kills_the_child() {
        let dir = temp_dir("drop");
        let script = write_script(
            &dir,
            "stub-server",
            "#!/bin/sh\necho 'the stub is ready'\nexec sleep 30.13\n",
        );
        let runtime = LocalRuntimeState::default();
        let started = start_with(
            &runtime,
            "stub",
            &script.display().to_string(),
            &[],
            "",
            Some("the stub is ready"),
            Duration::from_secs(60),
            Duration::from_secs(5),
        )
        .expect("the stub starts");
        assert!(process_runs(started.pid));
        drop(runtime);
        assert!(
            wait_until(|| !process_runs(started.pid), Duration::from_secs(3)),
            "drop must leave no child behind"
        );
    }

    /// A start that never becomes ready reports the child's LAST LINE, kills
    /// it, and leaves nothing running.
    #[cfg(unix)]
    #[test]
    fn a_failed_start_reports_the_last_line_and_leaves_nothing_running() {
        let dir = temp_dir("failed");
        let script = write_script(
            &dir,
            "stub-server",
            "#!/bin/sh\necho 'the model file is missing'\nsleep 30.14\n",
        );
        let runtime = LocalRuntimeState::default();
        let error = start_with(
            &runtime,
            "stub",
            &script.display().to_string(),
            &[],
            "",
            Some("this pattern never appears"),
            Duration::from_secs(60),
            Duration::from_millis(500),
        )
        .expect_err("the stub never becomes ready");
        assert!(error.contains("the model file is missing"), "{error}");
        assert!(error.contains("did not become ready"), "{error}");
        assert!(runtime.status().is_none());
        // The script path is unique, so its absence from /proc is the proof no
        // child survived the failed start.
        let needle = script.display().to_string();
        let still_there = std::fs::read_dir("/proc")
            .expect("/proc")
            .filter_map(Result::ok)
            .any(|entry| {
                std::fs::read(entry.path().join("cmdline"))
                    .map(|bytes| String::from_utf8_lossy(&bytes).contains(&needle))
                    .unwrap_or(false)
            });
        assert!(!still_there, "a failed start must leave no child running");
    }


    /// THE KEY NEVER REACHES AN ERROR: a child that echoes its argv has its
    /// key scrubbed out of the failure sentence, and the raw key appears
    /// nowhere in it.
    #[cfg(unix)]
    #[test]
    fn a_failure_sentence_never_carries_the_key() {
        let dir = temp_dir("scrub");
        let capture = dir.join("argv.txt");
        let script = write_script(
            &dir,
            "stub-server",
            &format!(
                "#!/bin/sh\nprintf '%s\\n' \"$@\" > '{}'\necho \"starting with $@\"\nsleep 30.15\n",
                capture.display()
            ),
        );
        let runtime = LocalRuntimeState::default();
        let error = start_with(
            &runtime,
            "stub",
            &script.display().to_string(),
            &["--api-key".to_string(), "{key}".to_string()],
            "",
            Some("this pattern never appears"),
            Duration::from_secs(60),
            Duration::from_millis(400),
        )
        .expect_err("the stub never becomes ready");
        let captured = std::fs::read_to_string(&capture).unwrap_or_default();
        let key = captured
            .lines()
            .skip(1)
            .next()
            .unwrap_or("")
            .trim()
            .to_string();
        assert!(!key.is_empty(), "the stub should have captured the key");
        assert!(!error.contains(&key), "the key must never be in an error");
        assert!(error.contains("[the key]"), "{error}");
    }
    /// A child that exits before readiness is its own failure state, with its
    /// last line and its exit code in one sentence.
    #[cfg(unix)]
    #[test]
    fn a_child_that_exits_is_reported_with_its_line() {
        let dir = temp_dir("exited");
        let script = write_script(
            &dir,
            "stub-server",
            "#!/bin/sh\necho 'no model is loaded'\nexit 7\n",
        );
        let runtime = LocalRuntimeState::default();
        let error = start_with(
            &runtime,
            "stub",
            &script.display().to_string(),
            &[],
            "",
            None,
            Duration::from_secs(60),
            Duration::from_secs(2),
        )
        .expect_err("it exits");
        assert!(error.contains("no model is loaded"), "{error}");
        assert!(error.contains("exit 7"), "{error}");
        assert!(runtime.status().is_none());
    }
}
