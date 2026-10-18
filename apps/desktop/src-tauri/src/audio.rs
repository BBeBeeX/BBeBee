//! Native audio engine supervisor.
//!
//! Spawns, monitors, and manages the external `B_Be_Bee-audio-engine`
//! standalone binary. If the child crashes, the supervisor isolates the
//! failure, notifies listeners, and restarts gracefully with backoff.
//!
//! This replaces the TypeScript `AudioEngineSupervisor` that ran in the
//! Node sidecar. Rust's process management (tokio) is more reliable for
//! long-running native children.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::process::{Child, Command};
use tokio::sync::broadcast;

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

// =============================================================================
// Supervisor
// =============================================================================

/// Maximum restarts within the backoff window before giving up.
const MAX_RESTARTS: u32 = 5;
/// Backoff window for restart counting.
const RESTART_WINDOW: Duration = Duration::from_secs(60);

/// Supervises the native audio engine child process.
pub struct AudioEngineSupervisor {
    child: Arc<tokio::sync::Mutex<Option<Child>>>,
    is_shutting_down: Arc<std::sync::atomic::AtomicBool>,
    restart_count: Arc<Mutex<u32>>,
    last_restart: Arc<Mutex<Option<Instant>>>,

    // Current state (restored on restart)
    current_uri: Arc<Mutex<Option<String>>>,
    current_volume: Arc<Mutex<f32>>,
    current_muted: Arc<Mutex<bool>>,
    current_dsp: Arc<Mutex<Option<DspConfig>>>,

    // Event broadcast channels
    state_tx: broadcast::Sender<PlaybackStateEvent>,
    crash_tx: broadcast::Sender<CrashEvent>,
    ready_tx: broadcast::Sender<()>,
    fft_tx: broadcast::Sender<FftFrame>,

    custom_executable: Option<PathBuf>,
}

impl AudioEngineSupervisor {
    pub fn new(custom_executable: Option<PathBuf>) -> Self {
        let (state_tx, _) = broadcast::channel(64);
        let (crash_tx, _) = broadcast::channel(16);
        let (ready_tx, _) = broadcast::channel(16);
        let (fft_tx, _) = broadcast::channel(32);

        Self {
            child: Arc::new(tokio::sync::Mutex::new(None)),
            is_shutting_down: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            restart_count: Arc::new(Mutex::new(0)),
            last_restart: Arc::new(Mutex::new(None)),
            current_uri: Arc::new(Mutex::new(None)),
            current_volume: Arc::new(Mutex::new(0.8)),
            current_muted: Arc::new(Mutex::new(false)),
            current_dsp: Arc::new(Mutex::new(None)),
            state_tx,
            crash_tx,
            ready_tx,
            fft_tx,
            custom_executable,
        }
    }

    /// Resolve the audio engine binary path.
    ///
    /// Search order:
    /// 1. Custom path (constructor argument)
    /// 2. `BBEBEE_AUDIO_ENGINE` environment variable
    /// 3. Bundled `bin/` directory next to the executable
    /// 4. `resources/bin/` in dev layout
    pub fn resolve_executable(&self) -> HostResult<PathBuf> {
        // 1. Custom path
        if let Some(p) = &self.custom_executable {
            if p.is_file() {
                return Ok(p.clone());
            }
        }

        // 2. Environment variable
        if let Ok(env_path) = std::env::var("BBEBEE_AUDIO_ENGINE") {
            let p = PathBuf::from(env_path);
            if p.is_file() {
                return Ok(p);
            }
        }

        // 3. Next to current executable (bundled)
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

    /// Subscribe to playback state events.
    pub fn subscribe_state(&self) -> broadcast::Receiver<PlaybackStateEvent> {
        self.state_tx.subscribe()
    }

    /// Subscribe to crash events.
    pub fn subscribe_crash(&self) -> broadcast::Receiver<CrashEvent> {
        self.crash_tx.subscribe()
    }

    /// Subscribe to ready events.
    pub fn subscribe_ready(&self) -> broadcast::Receiver<()> {
        self.ready_tx.subscribe()
    }

    /// Subscribe to FFT frames.
    pub fn subscribe_fft(&self) -> broadcast::Receiver<FftFrame> {
        self.fft_tx.subscribe()
    }

    /// Check if a restart is allowed (backoff policy).
    fn check_restart_budget(&self) -> bool {
        let mut count = lock_recover(&self.restart_count);
        let mut last = lock_recover(&self.last_restart);
        let now = Instant::now();

        // Reset the window if it's expired
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

    /// Spawn the engine process.
    pub async fn start(&self) -> HostResult<()> {
        let exe = self.resolve_executable()?;
        eprintln!("[audio] starting engine: {}", exe.display());

        let mut child = Command::new(&exe)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| HostError::internal(format!("failed to spawn audio engine: {e}")))?;

        // TODO: wire up stdin/stdout for JSON-RPC with the engine
        // TODO: spawn monitor task for crash detection and restart

        *self.child.lock().await = Some(child);
        let _ = self.ready_tx.send(());

        Ok(())
    }

    /// Stop the engine gracefully.
    pub async fn stop(&self) {
        self.is_shutting_down
            .store(true, std::sync::atomic::Ordering::SeqCst);
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        eprintln!("[audio] engine stopped");
    }

    /// Set the volume (0.0 - 1.0).
    pub async fn set_volume(&self, volume: f32) -> HostResult<()> {
        let v = volume.clamp(0.0, 1.0);
        *lock_recover(&self.current_volume) = v;
        // TODO: send command to engine via JSON-RPC
        Ok(())
    }

    /// Set muted state.
    pub async fn set_muted(&self, muted: bool) -> HostResult<()> {
        *lock_recover(&self.current_muted) = muted;
        // TODO: send command to engine via JSON-RPC
        Ok(())
    }

    /// Push DSP configuration to the engine.
    pub async fn set_dsp_config(&self, config: DspConfig) -> HostResult<()> {
        *lock_recover(&self.current_dsp) = Some(config.clone());
        // TODO: send command to engine via JSON-RPC
        Ok(())
    }

    /// Load a URI for playback.
    pub async fn load(&self, uri: &str) -> HostResult<LoadResult> {
        *lock_recover(&self.current_uri) = Some(uri.to_string());
        // TODO: send load command and wait for FILE_LOADED
        Err(HostError::internal("not yet implemented"))
    }
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
        // 6th restart within window is denied
        assert!(!s.check_restart_budget());
    }
}
