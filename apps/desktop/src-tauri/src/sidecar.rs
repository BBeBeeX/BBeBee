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
        }
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
        }
    }

    /// Resolve the path to the Node.js sidecar entry script.
    pub fn resolve_sidecar_script() -> Option<PathBuf> {
        if let Ok(env_path) = std::env::var("BBEBEE_SIDECAR_SCRIPT") {
            let p = PathBuf::from(env_path);
            if p.exists() {
                return Some(p);
            }
        }

        let candidates = [
            "apps/desktop/dist-sidecar/index.mjs",
            "dist-sidecar/index.mjs",
            "../dist-sidecar/index.mjs",
            "../../dist-sidecar/index.mjs",
            "apps/desktop/sidecar/index.ts",
            "../sidecar/index.ts",
            "sidecar/index.ts",
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

    /// Spawn the Node.js sidecar process and establish stdio line reading.
    pub async fn start(&self) -> Result<(), String> {
        if self.is_running().await {
            return Ok(());
        }

        let node_bin = std::env::var("NODE_BINARY")
            .or_else(|_| std::env::var("NODE_PATH"))
            .unwrap_or_else(|_| "node".to_string());

        let script_path = Self::resolve_sidecar_script().ok_or_else(|| {
            "Failed to resolve BBeBee Node.js sidecar script (looked for dist-sidecar/index.mjs and sidecar/index.ts)".to_string()
        })?;

        let is_ts = script_path
            .extension()
            .map(|ext| ext == "ts")
            .unwrap_or(false);

        let mut cmd = Command::new(&node_bin);
        if let Some(ref data_dir) = self.custom_data_dir {
            cmd.env("BBEBEE_DATA_DIR", data_dir);
            cmd.env("BBEBEE_DB_NAME", "test-BBeBee.db");
        }
        if is_ts {
            cmd.arg("--experimental-strip-types");
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
                                    let mut map = pending.lock().unwrap();
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
            let mut map = self.pending.lock().unwrap();
            map.insert(req_id, tx);
        }

        let payload = serde_json::json!({
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
            "params": params,
        });

        let line = format!("{}\n", serde_json::to_string(&payload).unwrap());

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
                let mut map = self.pending.lock().unwrap();
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

        let line = format!("{}\n", serde_json::to_string(&payload).unwrap());

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
        let mut map = self.pending.lock().unwrap();
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
        let script = SidecarManager::resolve_sidecar_script();
        assert!(script.is_some(), "Should find sidecar script");
        let path = script.unwrap();
        assert!(path.exists(), "Resolved sidecar script must exist");
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
