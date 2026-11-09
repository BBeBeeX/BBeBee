//! Node.js Headless Sidecar Supervisor and Stdio NDJSON JSON-RPC Transport.
//!
//! Spawns and manages the Node.js sidecar process over standard input/output
//! line-delimited JSON-RPC (NDJSON) framing. Exposes async RPC request dispatch
//! and forwards sidecar notifications as native Tauri events.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use crate::error::lock_recover;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::oneshot;

type PendingResponse = oneshot::Sender<Result<serde_json::Value, String>>;
type PendingMap = Arc<Mutex<HashMap<u64, PendingResponse>>>;

// ── Transport bounds ────────────────────────────────────────────────────────
//
// The sidecar pipe carries NDJSON lines that are fully buffered before they
// are parsed: one 16 MiB LAN response body base64-encodes to ~21 MB, plus JSON
// escaping, all on a single line. Without caps a runaway producer grows the
// host heap without limit (see docs/architecture/memory-governance.md). Every
// bound here answers: capacity → hard constant; overflow → drop + counter;
// monitoring → `SidecarCounters` via `counters()`.

/// Hard cap on one NDJSON line read from the sidecar's stdout.
pub const MAX_LINE_BYTES: usize = 32 * 1024 * 1024;
/// Hard cap on a notification payload before it may be broadcast to webviews.
pub const MAX_NOTIFY_BYTES: usize = 4 * 1024 * 1024;
/// Notification broadcasts per second before rate dropping kicks in.
pub const MAX_NOTIFY_PER_SEC: u32 = 200;
/// Cap on in-flight `call()` requests awaiting a reply.
pub const MAX_PENDING_CALLS: usize = 256;
/// Window (ms) for the notification rate limit.
const NOTIFY_WINDOW_MS: u64 = 1000;

/// Monotonic drop/forward counters exposed for the metrics system.
#[derive(Debug, Default, Clone)]
pub struct SidecarCounters {
    /// Lines exceeding `MAX_LINE_BYTES` — content discarded up to the newline.
    pub oversize_lines_dropped: Arc<AtomicU64>,
    /// Notifications whose serialized payload exceeded `MAX_NOTIFY_BYTES`.
    pub notifications_dropped_oversize: Arc<AtomicU64>,
    /// Notifications dropped because the per-second budget was exhausted.
    pub notifications_dropped_rate: Arc<AtomicU64>,
}

impl SidecarCounters {
    /// Latest counters as plain numbers (for the metrics command).
    pub fn snapshot(&self) -> serde_json::Value {
        serde_json::json!({
            "oversizeLinesDropped": self.oversize_lines_dropped.load(Ordering::Relaxed),
            "notificationsDroppedOversize": self.notifications_dropped_oversize.load(Ordering::Relaxed),
            "notificationsDroppedRate": self.notifications_dropped_rate.load(Ordering::Relaxed),
        })
    }
}

/// Outcome of gating one notification before it reaches the webviews.
#[derive(Debug, PartialEq, Eq)]
pub enum GateDecision {
    Forward,
    DropOversize,
    DropRate,
}

/// Fixed-window rate gate for notification broadcasts.
///
/// Pure with respect to the injected clock so tests can drive it without
/// sleeping. Who owns it: the stdout reader task. Capacity: n/a (stateless
/// beyond one window). Overflow: the notification is dropped and counted.
#[derive(Debug)]
pub struct NotifyGate {
    window_start_ms: u64,
    seen_this_window: u32,
}

impl Default for NotifyGate {
    fn default() -> Self {
        Self { window_start_ms: 0, seen_this_window: 0 }
    }
}

impl NotifyGate {
    pub fn admit(&mut self, payload_len: usize, now_ms: u64) -> GateDecision {
        if payload_len > MAX_NOTIFY_BYTES {
            return GateDecision::DropOversize;
        }
        if now_ms.saturating_sub(self.window_start_ms) >= NOTIFY_WINDOW_MS {
            self.window_start_ms = now_ms;
            self.seen_this_window = 0;
        }
        if self.seen_this_window >= MAX_NOTIFY_PER_SEC {
            return GateDecision::DropRate;
        }
        self.seen_this_window += 1;
        GateDecision::Forward
    }
}

fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Read one `\n`-delimited line with a hard byte cap.
///
/// Unlike `AsyncBufReadExt::read_line`, the staging buffer never grows past
/// `cap` bytes: an overlong line is discarded up to (and including) its
/// newline. Returns `(got_line, over_limit, eof)`:
/// - `(true,  false, _)` → `buf` holds a complete unter-cap line,
/// - `(false, true,  _)` → an over-cap line was discarded (keep reading),
/// - `(false, false, true)` → clean EOF, nothing further.
///
/// Ownership: caller owns `buf` (reused across calls, so the allocation is
/// bounded by `cap`). Failure: an I/O error aborts the read.
pub async fn read_limited_line<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    buf: &mut Vec<u8>,
    cap: usize,
) -> std::io::Result<(bool, bool, bool)> {
    buf.clear();
    let mut over_limit = false;
    loop {
        // The fill_buf borrow must end before consume(), so stage the outcome.
        enum Step { Eof, Consumed(usize, bool) }
        let step = {
            let available = reader.fill_buf().await?;
            if available.is_empty() {
                Step::Eof
            } else if let Some(idx) = available.iter().position(|&b| b == b'\n') {
                if !over_limit {
                    let room = cap.saturating_sub(buf.len());
                    if idx > room {
                        // The newline is in sight but the line already
                        // exceeds the cap: keep only the room we have.
                        buf.extend_from_slice(&available[..room]);
                        over_limit = true;
                    } else {
                        buf.extend_from_slice(&available[..idx]);
                    }
                }
                Step::Consumed(idx + 1, true)
            } else if !over_limit {
                let room = cap.saturating_sub(buf.len());
                if available.len() > room {
                    buf.extend_from_slice(&available[..room]);
                    over_limit = true;
                } else {
                    buf.extend_from_slice(available);
                }
                Step::Consumed(available.len(), false)
            } else {
                Step::Consumed(available.len(), false)
            }
        };
        match step {
            Step::Eof => {
                return Ok((!buf.is_empty() && !over_limit, over_limit, true));
            }
            Step::Consumed(n, complete) => {
                reader.consume(n);
                if complete {
                    return Ok((!over_limit, over_limit, false));
                }
            }
        }
    }
}

pub struct SidecarManager {
    stdin: Arc<tokio::sync::Mutex<Option<ChildStdin>>>,
    pending: PendingMap,
    next_id: AtomicU64,
    child: Arc<tokio::sync::Mutex<Option<Child>>>,
    is_shutting_down: Arc<AtomicBool>,
    app_handle: Option<AppHandle>,
    custom_data_dir: Option<PathBuf>,
    /// Entry script filename in dist-sidecar/ (default "index.mjs", cover uses "cover.mjs")
    script_name: String,
    counters: SidecarCounters,
}

impl SidecarManager {
    pub fn new(app_handle: Option<AppHandle>) -> Self {
        Self {
            stdin: Arc::new(tokio::sync::Mutex::new(None)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU64::new(1),
            child: Arc::new(tokio::sync::Mutex::new(None)),
            is_shutting_down: Arc::new(AtomicBool::new(false)),
            app_handle,
            custom_data_dir: None,
            script_name: "index.mjs".to_string(),
            counters: SidecarCounters::default(),
        }
    }

    /// Create a manager for the cover sidecar (dist-sidecar/cover.mjs).
    pub fn new_cover(app_handle: Option<AppHandle>) -> Self {
        let mut s = Self::new(app_handle);
        s.script_name = "cover.mjs".to_string();
        s
    }

    pub fn with_custom_data_dir(app_handle: Option<AppHandle>, data_dir: PathBuf) -> Self {
        Self {
            stdin: Arc::new(tokio::sync::Mutex::new(None)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU64::new(1),
            child: Arc::new(tokio::sync::Mutex::new(None)),
            is_shutting_down: Arc::new(AtomicBool::new(false)),
            app_handle,
            custom_data_dir: Some(data_dir),
            script_name: "index.mjs".to_string(),
            counters: SidecarCounters::default(),
        }
    }

    /// Drop/forward counters for the metrics system.
    pub fn counters(&self) -> &SidecarCounters {
        &self.counters
    }

    /// Resolve the path to the Node.js sidecar entry script.
    /// Uses `self.script_name` (e.g. "index.mjs" or "cover.mjs").
    pub fn resolve_sidecar_script(&self) -> Option<PathBuf> {
        if let Ok(env_path) = std::env::var("BBEBEE_SIDECAR_SCRIPT") {
            let p = PathBuf::from(env_path);
            if p.exists() {
                return Some(p);
            }
        }

        let candidates = [
            format!("apps/desktop/dist-sidecar/{}", self.script_name),
            format!("dist-sidecar/{}", self.script_name),
            format!("../dist-sidecar/{}", self.script_name),
            format!("../../dist-sidecar/{}", self.script_name),
        ];

        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        for rel in &candidates {
            let direct = cwd.join(rel);
            if direct.exists() {
                return Some(direct);
            }
            // Check relative to current exe dir
            if let Ok(exe) = std::env::current_exe() {
                if let Some(parent) = exe.parent() {
                    let from_exe = parent.join(rel);
                    if from_exe.exists() {
                        return Some(from_exe);
                    }
                }
            }
        }

        None
    }

    /// Resolve the executable path for Node.js.
    pub fn resolve_node_binary() -> String {
        // 1. Explicit environment variable override
        for var in &["NODE_BINARY", "NODE_BIN", "NODE_EXE"] {
            if let Ok(val) = std::env::var(var) {
                let trimmed = val.trim();
                if !trimmed.is_empty() {
                    let path = PathBuf::from(trimmed);
                    if path.is_file() {
                        return path.to_string_lossy().to_string();
                    }
                    if trimmed == "node" || trimmed == "node.exe" {
                        return trimmed.to_string();
                    }
                }
            }
        }

        let exe_name = if cfg!(windows) { "node.exe" } else { "node" };

        // 2. Bundled binary near current executable or working directory
        let mut candidates = Vec::new();
        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                candidates.push(parent.join(exe_name));
                candidates.push(parent.join("bin").join(exe_name));
                candidates.push(parent.join("resources").join("bin").join(exe_name));
                if let Some(grandparent) = parent.parent() {
                    candidates.push(grandparent.join("bin").join(exe_name));
                    candidates.push(grandparent.join("resources").join("bin").join(exe_name));
                }
            }
        }

        if let Ok(cwd) = std::env::current_dir() {
            candidates.push(cwd.join(exe_name));
            candidates.push(cwd.join("bin").join(exe_name));
            candidates.push(cwd.join("resources").join("bin").join(exe_name));
            candidates.push(cwd.join("apps").join("desktop").join("bin").join(exe_name));
        }

        for candidate in candidates {
            if candidate.is_file() {
                return candidate.to_string_lossy().to_string();
            }
        }

        // 3. System PATH directories lookup
        if let Some(paths) = std::env::var_os("PATH") {
            for dir in std::env::split_paths(&paths) {
                let candidate = dir.join(exe_name);
                if candidate.is_file() {
                    return candidate.to_string_lossy().to_string();
                }
            }
        }

        // 4. Well-known fallback install locations
        if cfg!(windows) {
            let win_defaults = [
                r"C:\Program Files\nodejs\node.exe",
                r"C:\Program Files (x86)\nodejs\node.exe",
            ];
            for path_str in &win_defaults {
                let p = PathBuf::from(path_str);
                if p.is_file() {
                    return p.to_string_lossy().to_string();
                }
            }
            if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
                let p = PathBuf::from(local_app_data).join("Programs").join("node").join("node.exe");
                if p.is_file() {
                    return p.to_string_lossy().to_string();
                }
            }
        } else {
            let unix_defaults = [
                "/usr/local/bin/node",
                "/usr/bin/node",
                "/opt/homebrew/bin/node",
            ];
            for path_str in &unix_defaults {
                let p = PathBuf::from(path_str);
                if p.is_file() {
                    return p.to_string_lossy().to_string();
                }
            }
        }

        // 5. Default fallback to let OS resolve via PATH
        exe_name.to_string()
    }

    /// Spawn the Node.js sidecar process and establish stdio line reading.
    pub async fn start(&self) -> Result<(), String> {
        if self.is_running().await {
            return Ok(());
        }

        let node_bin = Self::resolve_node_binary();

        let script_path = self.resolve_sidecar_script().ok_or_else(|| {
            format!(
                "Failed to resolve BBeBee Node.js sidecar script (looked for dist-sidecar/{})",
                self.script_name
            )
        })?;

        let mut cmd = Command::new(&node_bin);
        if let Some(ref data_dir) = self.custom_data_dir {
            cmd.env("BBEBEE_DATA_DIR", data_dir);
            cmd.env("BBEBEE_DB_NAME", "test-BBeBee.db");
        }
        cmd.arg(&script_path);

        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::inherit());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn Node sidecar with '{}': {}", node_bin, e))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture sidecar stdout".to_string())?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to capture sidecar stdin".to_string())?;

        *self.stdin.lock().await = Some(stdin);
        *self.child.lock().await = Some(child);
        self.is_shutting_down.store(false, Ordering::SeqCst);

        // Spawn stdout reader task
        let pending = Arc::clone(&self.pending);
        let app_handle = self.app_handle.clone();
        let is_shutting_down = Arc::clone(&self.is_shutting_down);
        let counters = self.counters.clone();

        tokio::spawn(async move {
            let mut reader = BufReader::with_capacity(64 * 1024, stdout);
            let mut line_bytes: Vec<u8> = Vec::with_capacity(8 * 1024);
            let mut gate = NotifyGate::default();

            loop {
                let (got_line, over_limit, eof) =
                    match read_limited_line(&mut reader, &mut line_bytes, MAX_LINE_BYTES).await {
                        Ok(result) => result,
                        Err(e) => {
                            eprintln!("[sidecar:rust:WARN] stdout read error: {e}");
                            break;
                        }
                    };
                if over_limit {
                    counters.oversize_lines_dropped.fetch_add(1, Ordering::Relaxed);
                    eprintln!(
                        "[sidecar:rust:WARN] dropped sidecar line over {} bytes",
                        MAX_LINE_BYTES
                    );
                }
                if !got_line {
                    if eof {
                        break;
                    }
                    // An over-cap line was dropped; the stream continues.
                    continue;
                }

                let trimmed = String::from_utf8_lossy(&line_bytes);
                let trimmed = trimmed.trim();
                if trimmed.is_empty() {
                    continue;
                }

                let parsed: Result<serde_json::Value, _> = serde_json::from_str(trimmed);
                match parsed {
                    Ok(val) => {
                        // Check if it's a request response (contains "id")
                        if let Some(id_val) = val.get("id") {
                            if !id_val.is_null() {
                                if let Some(req_id) = id_val.as_u64() {
                                    let mut map = lock_recover(&pending);
                                    if let Some(tx) = map.remove(&req_id) {
                                        if let Some(err) = val.get("error") {
                                            let msg = err
                                                .get("message")
                                                .and_then(|m| m.as_str())
                                                .unwrap_or("Unknown JSON-RPC error");
                                            let _ = tx.send(Err(msg.to_string()));
                                        } else if let Some(res) = val.get("result") {
                                            let _ = tx.send(Ok(res.clone()));
                                        } else {
                                            let _ = tx.send(Ok(serde_json::Value::Null));
                                        }
                                    }
                                }
                                continue;
                            }
                        }

                        // Notification (contains "method" without "id")
                        if let Some(method) = val.get("method").and_then(|m| m.as_str()) {
                            let params = val.get("params").cloned().unwrap_or(serde_json::Value::Null);

                            // Gate before it can fan out to every webview: a
                            // dropped notification is recoverable (state lives
                            // in the sender; webviews re-pull snapshots), an
                            // unbounded broadcast is not.
                            let payload_len =
                                serde_json::to_vec(&params).map(|v| v.len()).unwrap_or(0);
                            match gate.admit(payload_len, unix_ms()) {
                                GateDecision::DropOversize => {
                                    counters
                                        .notifications_dropped_oversize
                                        .fetch_add(1, Ordering::Relaxed);
                                    eprintln!(
                                        "[sidecar:rust:WARN] dropped notification '{method}' over {MAX_NOTIFY_BYTES} bytes"
                                    );
                                }
                                GateDecision::DropRate => {
                                    counters.notifications_dropped_rate.fetch_add(1, Ordering::Relaxed);
                                }
                                GateDecision::Forward => {
                                    if let Some(ref handle) = app_handle {
                                        // Forward notification as a Tauri event to the Webview
                                        let _ = handle.emit(method, &params);
                                    }
                                }
                            }

                            // Special host integrations (cheap, always run)
                            if method == "system:publishNowPlaying" {
                                if let Some(ref handle) = app_handle {
                                    if let Some(tray) = handle.tray_by_id("main-tray") {
                                        let title = params
                                            .as_array()
                                            .and_then(|arr| arr.first())
                                            .and_then(|obj| obj.get("title"))
                                            .and_then(|t| t.as_str())
                                            .unwrap_or("BBeBee");
                                        let tooltip = if title.is_empty() || title == "BBeBee" {
                                            "BBeBee".to_string()
                                        } else {
                                            format!("BBeBee — {}", title)
                                        };
                                        let _ = tray.set_tooltip(Some(tooltip));
                                    }
                                }
                            } else if method == "system:clearNowPlaying" {
                                if let Some(ref handle) = app_handle {
                                    if let Some(tray) = handle.tray_by_id("main-tray") {
                                        let _ = tray.set_tooltip(Some("BBeBee"));
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[sidecar:rust:WARN] Failed to parse NDJSON line: {} (line: '{}')", e, trimmed);
                    }
                }
            }

            if !is_shutting_down.load(Ordering::SeqCst) {
                eprintln!("[sidecar:rust:WARN] Node sidecar stdout stream closed unexpectedly");
            }
        });

        Ok(())
    }

    /// Current sidecar child pid, for the metrics sampler.
    pub async fn pid(&self) -> Option<u32> {
        let guard = self.child.lock().await;
        guard.as_ref().and_then(|c| c.id())
    }

    /// Check whether the sidecar process is currently alive.
    pub async fn is_running(&self) -> bool {
        let mut guard = self.child.lock().await;
        if let Some(ref mut child) = *guard {
            matches!(child.try_wait(), Ok(None))
        } else {
            false
        }
    }

    /// Dispatch a JSON-RPC request to the Node sidecar and wait for the response.
    pub async fn call(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        if !self.is_running().await {
            self.start().await?;
        }

        let req_id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();

        {
            let mut map = lock_recover(&self.pending);
            if map.len() >= MAX_PENDING_CALLS {
                return Err(format!(
                    "sidecar busy: {} calls already in flight (cap {})",
                    map.len(),
                    MAX_PENDING_CALLS
                ));
            }
            map.insert(req_id, tx);
        }

        let payload = serde_json::json!({
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
            "params": params,
        });

        let line = format!("{}\n", payload.to_string());

        {
            let mut stdin_guard = self.stdin.lock().await;
            if let Some(ref mut stdin) = *stdin_guard {
                stdin
                    .write_all(line.as_bytes())
                    .await
                    .map_err(|e| format!("Failed to write to sidecar stdin: {}", e))?;
                stdin
                    .flush()
                    .await
                    .map_err(|e| format!("Failed to flush sidecar stdin: {}", e))?;
            } else {
                return Err("Sidecar stdin is not connected".to_string());
            }
        }

        match tokio::time::timeout(Duration::from_secs(30), rx).await {
            Ok(Ok(res)) => res,
            Ok(Err(_)) => Err("Sidecar response channel dropped before reply".to_string()),
            Err(_) => {
                let mut map = lock_recover(&self.pending);
                map.remove(&req_id);
                Err(format!("Sidecar call '{}' timed out after 30 seconds", method))
            }
        }
    }

    /// Send a JSON-RPC notification (no reply expected).
    pub async fn notify(&self, method: &str, params: serde_json::Value) -> Result<(), String> {
        if !self.is_running().await {
            self.start().await?;
        }

        let payload = serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        });

        let line = format!("{}\n", payload.to_string());

        let mut stdin_guard = self.stdin.lock().await;
        if let Some(ref mut stdin) = *stdin_guard {
            stdin
                .write_all(line.as_bytes())
                .await
                .map_err(|e| format!("Failed to write notification to sidecar: {}", e))?;
            stdin
                .flush()
                .await
                .map_err(|e| format!("Failed to flush notification to sidecar: {}", e))?;
            Ok(())
        } else {
            Err("Sidecar stdin is not connected".to_string())
        }
    }

    /// Cleanly terminate the sidecar process.
    pub async fn shutdown(&self) -> Result<(), String> {
        self.is_shutting_down.store(true, Ordering::SeqCst);

        // Attempt graceful JSON-RPC notification first
        let _ = self.notify("shutdown", serde_json::json!([])).await;

        tokio::time::sleep(Duration::from_millis(200)).await;

        let mut guard = self.child.lock().await;
        if let Some(ref mut child) = *guard {
            let _ = child.kill().await;
        }
        *guard = None;
        *self.stdin.lock().await = None;

        // Drain any pending requests with shutdown error
        let mut map = lock_recover(&self.pending);
        for (_, tx) in map.drain() {
            let _ = tx.send(Err("Sidecar process terminated".to_string()));
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_sidecar_script() {
        let mgr = SidecarManager::new(None);
        let script = mgr.resolve_sidecar_script();
        assert!(script.is_some(), "Should find sidecar script");
        let path = script.unwrap();
        assert!(path.exists(), "Resolved sidecar script must exist");
    }

    #[test]
    fn test_resolve_node_binary() {
        // Even if NODE_PATH is set to search dirs, resolve_node_binary must never use it as binary path
        std::env::set_var("NODE_PATH", "fake/path/one:fake/path/two");
        let node_bin = SidecarManager::resolve_node_binary();
        assert!(!node_bin.contains("fake/path"), "Must not use NODE_PATH as binary path");
        assert!(node_bin.ends_with("node") || node_bin.ends_with("node.exe"));
    }

    #[test]
    fn test_sidecar_ping_roundtrip() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let tmp = std::env::temp_dir().join(format!("bbebee-ping-{}", std::process::id()));
            let _ = std::fs::create_dir_all(&tmp);
            let manager = SidecarManager::with_custom_data_dir(None, tmp.clone());
            let start_res = manager.start().await;
            assert!(start_res.is_ok(), "Sidecar start failed: {:?}", start_res);

            let ping_res = manager.call("sidecar:ping", serde_json::json!([])).await;
            assert!(ping_res.is_ok(), "Ping failed: {:?}", ping_res);
            assert_eq!(ping_res.unwrap(), serde_json::json!("pong"));

            let _ = manager.shutdown().await;
            let _ = std::fs::remove_dir_all(&tmp);
        });
    }

    #[test]
    fn test_sidecar_bridge_call_paths_get() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let tmp = std::env::temp_dir().join(format!("bbebee-paths-{}", std::process::id()));
            let _ = std::fs::create_dir_all(&tmp);
            let manager = SidecarManager::with_custom_data_dir(None, tmp.clone());
            let start_res = manager.start().await;
            assert!(start_res.is_ok(), "Sidecar start failed: {:?}", start_res);

            let res = manager
                .call(
                    "BBeBee:call",
                    serde_json::json!(["paths", "get", ["data"], null]),
                )
                .await;

            assert!(res.is_ok(), "BBeBee:call paths.get failed: {:?}", res);
            let val = res.unwrap();
            assert_eq!(val.get("__bbebee_bridge__").and_then(|v| v.as_bool()), Some(true));
            assert_eq!(val.get("ok").and_then(|v| v.as_bool()), Some(true));
            let result_uri = val.get("result").and_then(|v| v.as_str()).unwrap_or("");
            assert!(result_uri.starts_with("file://"), "Expected file:// URI, got: {}", result_uri);

            let _ = manager.shutdown().await;
            let _ = std::fs::remove_dir_all(&tmp);
        });
    }

    // ── notification gate ────────────────────────────────────────────────

    #[test]
    fn gate_forwards_under_rate_and_size() {
        let mut gate = NotifyGate::default();
        for i in 0..MAX_NOTIFY_PER_SEC {
            assert_eq!(
                gate.admit(1024, 1_000 + i as u64),
                GateDecision::Forward,
                "forward #{i} within budget"
            );
        }
        assert_eq!(gate.admit(1024, 1_500), GateDecision::DropRate);
        // A new window resets the budget.
        assert_eq!(gate.admit(1024, 1_000 + NOTIFY_WINDOW_MS), GateDecision::Forward);
    }

    #[test]
    fn gate_rejects_oversize_payloads() {
        let mut gate = NotifyGate::default();
        assert_eq!(
            gate.admit(MAX_NOTIFY_BYTES, 1_000),
            GateDecision::Forward,
            "exactly at the cap is fine"
        );
        assert_eq!(gate.admit(MAX_NOTIFY_BYTES + 1, 1_001), GateDecision::DropOversize);
        // Oversize rejections must not consume rate budget.
        assert_eq!(gate.admit(1, 1_001), GateDecision::Forward);
    }

    // ── bounded line reader ──────────────────────────────────────────────

    type LineResult = (bool, bool, bool, Vec<u8>);

    async fn drain(reader: &mut &[u8], buf: &mut Vec<u8>, cap: usize) -> Vec<LineResult> {
        let mut out = Vec::new();
        loop {
            let r = read_limited_line(reader, buf, cap).await.unwrap();
            let eof = r.2;
            out.push((r.0, r.1, r.2, buf.clone()));
            if eof {
                return out;
            }
        }
    }

    #[test]
    fn reader_passes_normal_lines_through() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let mut reader: &[u8] = b"one\ntwo\nthree\n";
            let mut buf = Vec::new();
            let lines = drain(&mut reader, &mut buf, 64).await;
            let got: Vec<_> = lines.iter().filter(|r| r.0).collect();
            assert_eq!(got.len(), 3, "all three lines survive: {lines:?}");
            assert!(lines.iter().all(|r| !r.1), "nothing flagged over-limit");
            assert!(lines.last().unwrap().2, "stream ends with EOF");
        });
    }

    #[test]
    fn reader_drops_overlong_line_and_continues() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let big = vec![b'x'; 200];
            let mut payload = big.clone();
            payload.extend_from_slice(b"\nafter\n");
            let mut reader: &[u8] = &payload;
            let mut buf = Vec::new();
            let lines = drain(&mut reader, &mut buf, 64).await;
            // First read: oversized line discarded; second: "after" survives.
            assert_eq!((lines[0].0, lines[0].1, lines[0].2), (false, true, false), "over-cap line dropped, stream alive");
            assert_eq!((lines[1].0, lines[1].1, lines[1].2), (true, false, false), "next line is intact");
            assert_eq!(lines[1].3, b"after");
        });
    }

    #[test]
    fn reader_handles_final_unterminated_line() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let mut reader: &[u8] = &b"no trailing newline"[..];
            let mut buf = Vec::new();
            let lines = drain(&mut reader, &mut buf, 64).await;
            assert_eq!(lines.len(), 1, "partial line and EOF flag arrive together: {lines:?}");
            assert_eq!((lines[0].0, lines[0].1, lines[0].2), (true, false, true), "partial line yielded with EOF flag");
            assert_eq!(lines[0].3, b"no trailing newline");
        });
    }

    #[test]
    fn reader_bounded_across_many_oversized_lines() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            // A flood of over-cap lines must never grow the staging buffer past cap.
            let big = vec![b'x'; 500];
            let mut payload = Vec::new();
            for _ in 0..50 {
                payload.extend_from_slice(&big);
                payload.push(b'\n');
            }
            payload.extend_from_slice(b"tail\n");
            let mut reader: &[u8] = &payload;
            let mut buf = Vec::new();
            let cap = 64usize;
            let lines = drain(&mut reader, &mut buf, cap).await;
            let dropped = lines.iter().filter(|r| r.1).count();
            assert_eq!(dropped, 50, "all 50 oversized lines dropped");
            assert!(lines.iter().all(|r| r.3.len() <= cap), "staging buffer stayed bounded");
            assert_eq!(lines[50].3, b"tail", "the line after the flood survives");
        });
    }
}
