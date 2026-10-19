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
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use crate::error::lock_recover;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::oneshot;

type PendingResponse = oneshot::Sender<Result<serde_json::Value, String>>;
type PendingMap = Arc<Mutex<HashMap<u64, PendingResponse>>>;

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
        }
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

        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();

            while let Ok(Some(line)) = reader.next_line().await {
                let trimmed = line.trim();
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

                            if let Some(ref handle) = app_handle {
                                // Forward notification as a Tauri event to the Webview
                                let _ = handle.emit(method, &params);

                                // Special host integrations
                                if method == "system:publishNowPlaying" {
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
                                } else if method == "system:clearNowPlaying" {
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
}
