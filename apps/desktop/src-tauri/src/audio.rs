//! Native audio engine supervisor.
//!
//! Spawns, monitors, and manages the external `B_Be_Bee-audio-engine`
//! standalone binary. If the child crashes, the supervisor isolates the
//! failure, notifies listeners, and restarts gracefully with backoff.
//!
//! Protocol: NDJSON over stdin/stdout. Commands are `{action, ...}` objects
//! written as single lines; the engine replies with `{type, ...}` messages.
//!
//! This replaces the TypeScript `AudioEngineSupervisor` that ran in the
//! Node sidecar. Rust's process management (tokio) is more reliable for
//! long-running native children.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{broadcast, oneshot};

use crate::error::{lock_recover, HostError, HostResult};

// =============================================================================
// Types (mirroring the TS interfaces)
// =============================================================================

/// DSP effect chain configuration for the native engine.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DspConfig {
    pub af: Option<String>,
    pub replaygain: Option<String>,
    pub replaygain_clip: Option<bool>,
    pub replaygain_preamp: Option<String>,
    pub replaygain_fallback: Option<String>,
}

/// FFT spectrum frame from the engine's PCM tap.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FftFrame {
    pub frequency_data: Vec<f32>,
    pub time_domain_data: Vec<f32>,
}

/// Playback state event from the engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStateEvent {
    pub status: PlaybackStatus,
    pub position_ms: f64,
    pub duration_ms: f64,
    pub ended_count: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackStatus {
    Idle,
    Playing,
    Paused,
    Stopped,
    Stalled,
    Loading,
    Error,
    Ended,
}

/// Engine crash event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashEvent {
    pub code: Option<i32>,
    pub signal: Option<String>,
    pub restarting: bool,
}

/// Result of a `load` command.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadResult {
    pub duration_ms: f64,
    pub uri: String,
    pub sample_rate: Option<u32>,
    pub channels: Option<u32>,
    pub bit_depth: Option<u32>,
    pub resumed: Option<bool>,
    pub ended_count: Option<u32>,
}

/// Incoming engine message (tagged by `type`).
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum EngineMessage {
    Ready {
        #[serde(default)]
        mpv_available: bool,
        #[serde(default)]
        pcm_tap_available: bool,
    },
    Loaded {
        #[serde(default)]
        duration_ms: f64,
        #[serde(default)]
        uri: String,
        #[serde(default)]
        resumed: bool,
        #[serde(default)]
        sample_rate: Option<u32>,
        #[serde(default)]
        channels: Option<u32>,
        #[serde(default)]
        bit_depth: Option<u32>,
    },
    State(PlaybackStateEvent),
    Fft(FftFrame),
    Error {
        #[serde(default)]
        message: String,
        #[serde(default)]
        action: Option<String>,
    },
    #[serde(other)]
    Unknown,
}

// =============================================================================
// Supervisor
// =============================================================================

/// Maximum restarts within the backoff window before giving up.
const MAX_RESTARTS: u32 = 5;
/// Backoff window for restart counting.
const RESTART_WINDOW: Duration = Duration::from_secs(60);
/// Load timeout for local files.
const LOAD_TIMEOUT_LOCAL: Duration = Duration::from_secs(15);
/// Load timeout for remote URLs.
const LOAD_TIMEOUT_REMOTE: Duration = Duration::from_secs(30);

type PendingLoads = Arc<Mutex<Vec<oneshot::Sender<HostResult<LoadResult>>>>>;

/// Supervises the native audio engine child process.
pub struct AudioEngineSupervisor {
    child: Arc<tokio::sync::Mutex<Option<Child>>>,
    stdin: Arc<tokio::sync::Mutex<Option<ChildStdin>>>,
    is_shutting_down: Arc<std::sync::atomic::AtomicBool>,
    restart_count: Arc<Mutex<u32>>,
    last_restart: Arc<Mutex<Option<Instant>>>,
    pending_loads: PendingLoads,

    // Current state (restored on restart)
    current_uri: Arc<Mutex<Option<String>>>,
    current_volume: Arc<Mutex<f32>>,
    current_muted: Arc<Mutex<bool>>,
    current_dsp: Arc<Mutex<Option<DspConfig>>>,
    mpv_available: Arc<std::sync::atomic::AtomicBool>,
    pcm_tap_available: Arc<std::sync::atomic::AtomicBool>,

    // Event broadcast channels
    state_tx: broadcast::Sender<PlaybackStateEvent>,
    crash_tx: broadcast::Sender<CrashEvent>,
    ready_tx: broadcast::Sender<()>,
    fft_tx: broadcast::Sender<FftFrame>,
    ended_tx: broadcast::Sender<()>,

    custom_executable: Option<PathBuf>,
}

impl AudioEngineSupervisor {
    pub fn new(custom_executable: Option<PathBuf>) -> Self {
        let (state_tx, _) = broadcast::channel(64);
        let (crash_tx, _) = broadcast::channel(16);
        let (ready_tx, _) = broadcast::channel(16);
        let (fft_tx, _) = broadcast::channel(32);
        let (ended_tx, _) = broadcast::channel(16);

        Self {
            child: Arc::new(tokio::sync::Mutex::new(None)),
            stdin: Arc::new(tokio::sync::Mutex::new(None)),
            is_shutting_down: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            restart_count: Arc::new(Mutex::new(0)),
            last_restart: Arc::new(Mutex::new(None)),
            pending_loads: Arc::new(Mutex::new(Vec::new())),
            current_uri: Arc::new(Mutex::new(None)),
            current_volume: Arc::new(Mutex::new(0.8)),
            current_muted: Arc::new(Mutex::new(false)),
            current_dsp: Arc::new(Mutex::new(None)),
            mpv_available: Arc::new(std::sync::atomic::AtomicBool::new(true)),
            pcm_tap_available: Arc::new(std::sync::atomic::AtomicBool::new(true)),
            state_tx,
            crash_tx,
            ready_tx,
            fft_tx,
            ended_tx,
            custom_executable,
        }
    }

    /// Resolve the audio engine binary path.
    pub fn resolve_executable(&self) -> HostResult<PathBuf> {
        if let Some(p) = &self.custom_executable {
            if p.is_file() {
                return Ok(p.clone());
            }
        }

        if let Ok(env_path) = std::env::var("BBEBEE_AUDIO_ENGINE") {
            let p = PathBuf::from(env_path);
            if p.is_file() {
                return Ok(p);
            }
        }

        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                for name in &["bbebee-audio-engine", "bbebee-audio-engine.exe"] {
                    let p = dir.join("bin").join(name);
                    if p.is_file() {
                        return Ok(p);
                    }
                    let p = dir.join(name);
                    if p.is_file() {
                        return Ok(p);
                    }
                }
            }
        }

        Err(HostError::not_found(
            "audio engine binary not found (set BBEBEE_AUDIO_ENGINE)",
        ))
    }

    // --- Subscriptions ---

    pub fn subscribe_state(&self) -> broadcast::Receiver<PlaybackStateEvent> {
        self.state_tx.subscribe()
    }
    pub fn subscribe_crash(&self) -> broadcast::Receiver<CrashEvent> {
        self.crash_tx.subscribe()
    }
    pub fn subscribe_ready(&self) -> broadcast::Receiver<()> {
        self.ready_tx.subscribe()
    }
    pub fn subscribe_fft(&self) -> broadcast::Receiver<FftFrame> {
        self.fft_tx.subscribe()
    }
    pub fn subscribe_ended(&self) -> broadcast::Receiver<()> {
        self.ended_tx.subscribe()
    }

    // --- Process lifecycle ---

    /// Check if a restart is allowed (backoff policy).
    fn check_restart_budget(&self) -> bool {
        let mut count = lock_recover(&self.restart_count);
        let mut last = lock_recover(&self.last_restart);
        let now = Instant::now();

        if let Some(t) = *last {
            if now.duration_since(t) > RESTART_WINDOW {
                *count = 0;
            }
        }

        if *count >= MAX_RESTARTS {
            return false;
        }

        *count += 1;
        *last = Some(now);
        true
    }

    /// Spawn the engine process and wire up stdio.
    pub async fn start(&self) -> HostResult<()> {
        let exe = self.resolve_executable()?;
        eprintln!("[audio] starting engine: {}", exe.display());

        let mut child = Command::new(&exe)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| HostError::internal(format!("failed to spawn audio engine: {e}")))?;

        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        *self.stdin.lock().await = stdin;
        *self.child.lock().await = Some(child);

        // Spawn stdout reader task
        if let Some(stdout) = stdout {
            self.spawn_stdout_reader(stdout);
        }

        // Spawn stderr logger task
        if let Some(stderr) = stderr {
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut line = String::new();
                loop {
                    line.clear();
                    match reader.read_line(&mut line).await {
                        Ok(0) => break,
                        Ok(_) => {
                            let text = line.trim();
                            if !text.is_empty() {
                                eprintln!("[audio:stderr] {text}");
                            }
                        }
                        Err(_) => break,
                    }
                }
            });
        }

        // Spawn exit monitor task
        self.spawn_exit_monitor();

        Ok(())
    }

    /// Read NDJSON lines from the engine's stdout and dispatch.
    fn spawn_stdout_reader(&self, stdout: tokio::process::ChildStdout) {
        let state_tx = self.state_tx.clone();
        let fft_tx = self.fft_tx.clone();
        let ready_tx = self.ready_tx.clone();
        let ended_tx = self.ended_tx.clone();
        let pending_loads = self.pending_loads.clone();
        let current_uri = self.current_uri.clone();
        let mpv_available = self.mpv_available.clone();
        let pcm_tap_available = self.pcm_tap_available.clone();

        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => break, // EOF
                    Ok(_) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        match serde_json::from_str::<EngineMessage>(trimmed) {
                            Ok(msg) => {
                                Self::dispatch_message(
                                    msg,
                                    &state_tx,
                                    &fft_tx,
                                    &ready_tx,
                                    &ended_tx,
                                    &pending_loads,
                                    &current_uri,
                                    &mpv_available,
                                    &pcm_tap_available,
                                );
                            }
                            Err(_) => {
                                eprintln!("[audio] unparseable stdout line: {trimmed}");
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[audio] stdout read error: {e}");
                        break;
                    }
                }
            }
        });
    }

    /// Dispatch a parsed engine message to the right channel.
    #[allow(clippy::too_many_arguments)]
    fn dispatch_message(
        msg: EngineMessage,
        state_tx: &broadcast::Sender<PlaybackStateEvent>,
        fft_tx: &broadcast::Sender<FftFrame>,
        ready_tx: &broadcast::Sender<()>,
        ended_tx: &broadcast::Sender<()>,
        pending_loads: &PendingLoads,
        current_uri: &Arc<Mutex<Option<String>>>,
        mpv_available: &Arc<std::sync::atomic::AtomicBool>,
        pcm_tap_available: &Arc<std::sync::atomic::AtomicBool>,
    ) {
        match msg {
            EngineMessage::Ready {
                mpv_available: mpv,
                pcm_tap_available: pcm,
            } => {
                // Note: TS defaults to true when the field is absent
                mpv_available.store(mpv, std::sync::atomic::Ordering::SeqCst);
                pcm_tap_available.store(pcm, std::sync::atomic::Ordering::SeqCst);
                let _ = ready_tx.send(());
            }
            EngineMessage::Loaded {
                duration_ms,
                uri,
                resumed,
                sample_rate,
                channels,
                bit_depth,
            } => {
                let uri = if uri.is_empty() {
                    lock_recover(current_uri).clone().unwrap_or_default()
                } else {
                    uri
                };
                let result = LoadResult {
                    duration_ms,
                    uri,
                    sample_rate,
                    channels,
                    bit_depth,
                    resumed: Some(resumed),
                    ended_count: None,
                };
                // Resolve all pending loads (they're for the same URI)
                let mut pending = lock_recover(pending_loads);
                for tx in pending.drain(..) {
                    let _ = tx.send(Ok(result.clone()));
                }
            }
            EngineMessage::State(event) => {
                if event.status == PlaybackStatus::Ended {
                    let _ = ended_tx.send(());
                }
                let _ = state_tx.send(event);
            }
            EngineMessage::Fft(frame) => {
                let _ = fft_tx.send(frame);
            }
            EngineMessage::Error { message, action } => {
                eprintln!(
                    "[audio] engine error{}: {message}",
                    action.map(|a| format!(" ({a})")).unwrap_or_default()
                );
                // Reject pending loads on error (unless it's a benign action)
                if action.as_deref() != Some("setDspConfig") {
                    let mut pending = lock_recover(pending_loads);
                    for tx in pending.drain(..) {
                        let _ = tx.send(Err(HostError::internal(message.clone())));
                    }
                }
            }
            EngineMessage::Unknown => {}
        }
    }

    /// Monitor the child process for exit; restart on crash.
    fn spawn_exit_monitor(&self) {
        let child = self.child.clone();
        let is_shutting_down = self.is_shutting_down.clone();
        let crash_tx = self.crash_tx.clone();
        // Clone Arcs for the restart
        let supervisor = self.clone_for_restart();

        tokio::spawn(async move {
            // Wait for the child to exit
            let exit_status = {
                let mut guard = child.lock().await;
                if let Some(c) = guard.as_mut() {
                    c.wait().await.ok()
                } else {
                    None
                }
            };

            if is_shutting_down.load(std::sync::atomic::Ordering::SeqCst) {
                return;
            }

            let (code, signal) = match exit_status {
                Some(s) => (s.code(), None),
                None => (None, Some("unknown".to_string())),
            };
            eprintln!("[audio] engine exited: code={code:?}");

            // Check restart budget
            let restarting = supervisor.check_restart_budget();
            let _ = crash_tx.send(CrashEvent {
                code,
                signal,
                restarting,
            });

            if restarting {
                // Brief delay before restart
                tokio::time::sleep(Duration::from_secs(1)).await;
                if let Err(e) = supervisor.start().await {
                    eprintln!("[audio] restart failed: {e}");
                }
            } else {
                eprintln!("[audio] restart budget exhausted, giving up");
            }
        });
    }

    /// Clone the Arcs needed for restart (avoids cloning the whole struct).
    fn clone_for_restart(&self) -> RestartHandle {
        RestartHandle {
            restart_count: self.restart_count.clone(),
            last_restart: self.last_restart.clone(),
            crash_tx: self.crash_tx.clone(),
            is_shutting_down: self.is_shutting_down.clone(),
            child: self.child.clone(),
            stdin: self.stdin.clone(),
            pending_loads: self.pending_loads.clone(),
            current_uri: self.current_uri.clone(),
            current_volume: self.current_volume.clone(),
            current_muted: self.current_muted.clone(),
            current_dsp: self.current_dsp.clone(),
            mpv_available: self.mpv_available.clone(),
            pcm_tap_available: self.pcm_tap_available.clone(),
            state_tx: self.state_tx.clone(),
            ready_tx: self.ready_tx.clone(),
            fft_tx: self.fft_tx.clone(),
            ended_tx: self.ended_tx.clone(),
            custom_executable: self.custom_executable.clone(),
        }
    }

    /// Stop the engine gracefully.
    pub async fn stop(&self) {
        self.is_shutting_down
            .store(true, std::sync::atomic::Ordering::SeqCst);
        // Fail all pending loads
        {
            let mut pending = lock_recover(&self.pending_loads);
            for tx in pending.drain(..) {
                let _ = tx.send(Err(HostError::internal("engine shutting down")));
            }
        }
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        eprintln!("[audio] engine stopped");
    }

    // --- Commands ---

    /// Send a JSON command to the engine's stdin.
    async fn send_command(&self, cmd: serde_json::Value) -> HostResult<()> {
        let line = format!("{}\n", cmd);
        let mut guard = self.stdin.lock().await;
        if let Some(stdin) = guard.as_mut() {
            stdin
                .write_all(line.as_bytes())
                .await
                .map_err(|e| HostError::internal(format!("write to engine failed: {e}")))?;
            stdin
                .flush()
                .await
                .map_err(|e| HostError::internal(format!("flush to engine failed: {e}")))?;
            Ok(())
        } else {
            Err(HostError::internal("engine stdin not available"))
        }
    }

    /// Load a URI for playback, waiting for the `loaded` event.
    pub async fn load(&self, uri: &str) -> HostResult<LoadResult> {
        let timeout = if uri.starts_with("http://") || uri.starts_with("https://") {
            LOAD_TIMEOUT_REMOTE
        } else {
            LOAD_TIMEOUT_LOCAL
        };

        let (tx, rx) = oneshot::channel();
        lock_recover(&self.pending_loads).push(tx);

        *lock_recover(&self.current_uri) = Some(uri.to_string());
        self.send_command(serde_json::json!({
            "action": "load",
            "uri": uri,
        }))
        .await?;

        tokio::time::timeout(timeout, rx)
            .await
            .map_err(|_| HostError::internal(format!("load timed out after {timeout:?}")))?
            .map_err(|_| HostError::internal("load channel closed"))?
    }

    pub async fn play(&self) -> HostResult<()> {
        self.send_command(serde_json::json!({ "action": "play" }))
            .await
    }

    pub async fn play_at(&self, at_ms: f64) -> HostResult<()> {
        self.send_command(serde_json::json!({ "action": "play", "atMs": at_ms }))
            .await
    }

    pub async fn pause(&self) -> HostResult<()> {
        self.send_command(serde_json::json!({ "action": "pause" }))
            .await
    }

    pub async fn stop_playback(&self) -> HostResult<()> {
        self.send_command(serde_json::json!({ "action": "stop" }))
            .await
    }

    pub async fn seek(&self, position_ms: f64) -> HostResult<()> {
        self.send_command(serde_json::json!({ "action": "seek", "positionMs": position_ms }))
            .await
    }

    pub async fn set_volume(&self, volume: f32) -> HostResult<()> {
        let v = volume.clamp(0.0, 1.0);
        *lock_recover(&self.current_volume) = v;
        self.send_command(serde_json::json!({ "action": "setVolume", "volume": v }))
            .await
    }

    pub async fn set_muted(&self, muted: bool) -> HostResult<()> {
        *lock_recover(&self.current_muted) = muted;
        self.send_command(serde_json::json!({ "action": "setMuted", "muted": muted }))
            .await
    }

    pub async fn set_dsp_config(&self, config: DspConfig) -> HostResult<()> {
        *lock_recover(&self.current_dsp) = Some(config.clone());
        self.send_command(serde_json::json!({ "action": "setDspConfig", "config": config }))
            .await
    }

    pub async fn set_output_device(&self, device_id: &str) -> HostResult<()> {
        self.send_command(serde_json::json!({ "action": "setOutputDevice", "deviceId": device_id }))
            .await
    }

    pub async fn set_visualizer(&self, enabled: bool, fft_size: u32) -> HostResult<()> {
        self.send_command(
            serde_json::json!({ "action": "setVisualizer", "enabled": enabled, "fftSize": fft_size }),
        )
        .await
    }

    /// Engine health status.
    pub fn get_engine_status(&self) -> EngineStatus {
        EngineStatus {
            running: true, // TODO: track actual state
            mpv_available: self.mpv_available.load(std::sync::atomic::Ordering::SeqCst),
            pcm_tap_available: self
                .pcm_tap_available
                .load(std::sync::atomic::Ordering::SeqCst),
        }
    }
}

/// Minimal handle for restart (avoids cloning the full supervisor).
struct RestartHandle {
    restart_count: Arc<Mutex<u32>>,
    last_restart: Arc<Mutex<Option<Instant>>>,
    crash_tx: broadcast::Sender<CrashEvent>,
    is_shutting_down: Arc<std::sync::atomic::AtomicBool>,
    child: Arc<tokio::sync::Mutex<Option<Child>>>,
    stdin: Arc<tokio::sync::Mutex<Option<ChildStdin>>>,
    pending_loads: PendingLoads,
    current_uri: Arc<Mutex<Option<String>>>,
    current_volume: Arc<Mutex<f32>>,
    current_muted: Arc<Mutex<bool>>,
    current_dsp: Arc<Mutex<Option<DspConfig>>>,
    mpv_available: Arc<std::sync::atomic::AtomicBool>,
    pcm_tap_available: Arc<std::sync::atomic::AtomicBool>,
    state_tx: broadcast::Sender<PlaybackStateEvent>,
    ready_tx: broadcast::Sender<()>,
    fft_tx: broadcast::Sender<FftFrame>,
    ended_tx: broadcast::Sender<()>,
    custom_executable: Option<PathBuf>,
}

impl RestartHandle {
    fn check_restart_budget(&self) -> bool {
        let mut count = lock_recover(&self.restart_count);
        let mut last = lock_recover(&self.last_restart);
        let now = Instant::now();
        if let Some(t) = *last {
            if now.duration_since(t) > RESTART_WINDOW {
                *count = 0;
            }
        }
        if *count >= MAX_RESTARTS {
            return false;
        }
        *count += 1;
        *last = Some(now);
        true
    }

    async fn start(&self) -> HostResult<()> {
        // Rebuild a supervisor from the handle and start it.
        // Note: this creates new broadcast channels; existing subscribers
        // on the old supervisor will not receive events from the restarted
        // engine. For full fidelity, the supervisor should be behind an
        // Arc and never replaced — this is a known limitation of the
        // skeleton.
        let s = AudioEngineSupervisor {
            child: self.child.clone(),
            stdin: self.stdin.clone(),
            is_shutting_down: self.is_shutting_down.clone(),
            restart_count: self.restart_count.clone(),
            last_restart: self.last_restart.clone(),
            pending_loads: self.pending_loads.clone(),
            current_uri: self.current_uri.clone(),
            current_volume: self.current_volume.clone(),
            current_muted: self.current_muted.clone(),
            current_dsp: self.current_dsp.clone(),
            mpv_available: self.mpv_available.clone(),
            pcm_tap_available: self.pcm_tap_available.clone(),
            state_tx: self.state_tx.clone(),
            crash_tx: self.crash_tx.clone(),
            ready_tx: self.ready_tx.clone(),
            fft_tx: self.fft_tx.clone(),
            ended_tx: self.ended_tx.clone(),
            custom_executable: self.custom_executable.clone(),
        };
        // Clear the shutting-down flag for the restart
        s.is_shutting_down
            .store(false, std::sync::atomic::Ordering::SeqCst);
        s.start().await
    }
}

/// Engine health status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub running: bool,
    pub mpv_available: bool,
    pub pcm_tap_available: bool,
}

// Re-export HashMap usage to avoid unused import warning in some configs
#[allow(unused)]
fn _use_hashmap() {
    let _: HashMap<String, String> = HashMap::new();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dsp_config_serializes() {
        let cfg = DspConfig {
            af: Some("acompressor=threshold=-20dB".to_string()),
            replaygain: Some("track".to_string()),
            ..Default::default()
        };
        let json = serde_json::to_value(&cfg).unwrap();
        assert_eq!(json["af"], "acompressor=threshold=-20dB");
    }

    #[test]
    fn restart_budget_allows_initial_restarts() {
        let s = AudioEngineSupervisor::new(None);
        for _ in 0..MAX_RESTARTS {
            assert!(s.check_restart_budget());
        }
        assert!(!s.check_restart_budget());
    }

    #[test]
    fn engine_message_parses_ready() {
        let msg: EngineMessage =
            serde_json::from_str(r#"{"type":"ready","mpvAvailable":true}"#).unwrap();
        matches!(msg, EngineMessage::Ready { .. });
    }

    #[test]
    fn engine_message_parses_loaded() {
        let msg: EngineMessage = serde_json::from_str(
            r#"{"type":"loaded","durationMs":180000,"uri":"file:///x.mp3"}"#,
        )
        .unwrap();
        match msg {
            EngineMessage::Loaded { duration_ms, .. } => assert_eq!(duration_ms, 180000.0),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn engine_message_unknown_type_is_tolerated() {
        let msg: EngineMessage =
            serde_json::from_str(r#"{"type":"something-new","foo":1}"#).unwrap();
        matches!(msg, EngineMessage::Unknown);
    }
}
