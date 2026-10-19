//! Shared application state.
//!
//! `AppState` is managed by Tauri (`app.manage()`) and shared across all
//! windows and commands. Conventions:
//!
//! - `AtomicBool` for simple flags (quitting, visibility).
//! - `Mutex<T>` for compound state; always access via `lock_recover()`
//!   (never `.lock().unwrap()`) so a poisoned mutex degrades instead of
//!   panicking the host.
//! - Getters/setters are the only public API; fields stay `pub` for the
//!   few places that need direct access during setup.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use crate::error::lock_recover;

// =============================================================================
// Plain data types (serialized over IPC)
// =============================================================================

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct Position {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniPlayerServiceState {
    pub visible: bool,
    pub mode: String,
    pub window_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MiniPlayerOpenOptions {
    pub mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TaskbarState {
    pub is_playing: bool,
    pub can_play_or_pause: Option<bool>,
    pub can_previous: Option<bool>,
    pub can_next: Option<bool>,
    pub title: Option<String>,
    pub artist: Option<String>,
}

// =============================================================================
// AppState
// =============================================================================

pub struct AppState {
    // Lifecycle
    pub close_to_tray: AtomicBool,
    pub quitting: AtomicBool,
    pub locale: Mutex<String>,

    // Desktop lyrics window
    pub latest_lyric_data: Mutex<Option<serde_json::Value>>,
    pub lyric_window_visible: AtomicBool,
    pub lyric_window_locked: AtomicBool,
    pub lyric_programmatic_move: AtomicBool,

    // Mini player window
    pub latest_mini_player_data: Mutex<Option<serde_json::Value>>,
    pub mini_player_mode: Mutex<String>,
    pub mini_player_window_state: Mutex<String>,
    pub mini_player_last_floating_pos: Mutex<Option<(i32, i32)>>,
    pub mini_player_programmatic_move: AtomicBool,
    /// Generation counter bumped on every mini-player `Moved` event; the
    /// deferred snap transition only fires when the counter stops changing
    /// (i.e. the drag has ended).
    pub mini_player_move_seq: AtomicU64,

    // Taskbar / media integration
    pub taskbar_state: Mutex<TaskbarState>,

    // Power management
    pub sleep_blockers: Mutex<HashSet<u32>>,

    // Hotkeys
    pub registered_hotkeys: Mutex<HashSet<String>>,
    pub media_keys_active: AtomicBool,

    // Media session
    pub current_now_playing: Mutex<Option<serde_json::Value>>,
    pub current_playback_state: Mutex<String>,
    pub current_position_ms: Mutex<f64>,

    // Sidecar
    pub sidecar: Mutex<Option<Arc<crate::sidecar::SidecarManager>>>,
    /// Dedicated cover sidecar (dist-sidecar/cover.mjs) — separate bridge so
    /// artwork batches never starve the main sidecar's calls.
    pub cover_sidecar: Mutex<Option<Arc<crate::sidecar::SidecarManager>>>,

    // Native audio engine (Rust supervisor, P0 migration from Node sidecar)
    pub audio_engine: Mutex<Option<Arc<crate::audio::AudioEngineSupervisor>>>,

    // FFmpeg transcoding (Rust manager, P1 migration from Node sidecar)
    pub transcode_manager: Arc<crate::transcode::TranscodeManager>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            close_to_tray: AtomicBool::new(true),
            quitting: AtomicBool::new(false),
            locale: Mutex::new("en".to_string()),

            latest_lyric_data: Mutex::new(None),
            lyric_window_visible: AtomicBool::new(false),
            lyric_window_locked: AtomicBool::new(false),
            lyric_programmatic_move: AtomicBool::new(false),

            latest_mini_player_data: Mutex::new(None),
            mini_player_mode: Mutex::new("normal".to_string()),
            mini_player_window_state: Mutex::new("hidden".to_string()),
            mini_player_last_floating_pos: Mutex::new(None),
            mini_player_programmatic_move: AtomicBool::new(false),
            mini_player_move_seq: AtomicU64::new(0),

            taskbar_state: Mutex::new(TaskbarState::default()),
            sleep_blockers: Mutex::new(HashSet::new()),
            registered_hotkeys: Mutex::new(HashSet::new()),
            media_keys_active: AtomicBool::new(false),
            current_now_playing: Mutex::new(None),
            current_playback_state: Mutex::new("stopped".to_string()),
            current_position_ms: Mutex::new(0.0),
            sidecar: Mutex::new(None),
            cover_sidecar: Mutex::new(None),
            audio_engine: Mutex::new(None),
            transcode_manager: Arc::new(crate::transcode::TranscodeManager::new()),
        }
    }
}

impl AppState {
    // --- Lifecycle ---

    pub fn is_quitting(&self) -> bool {
        self.quitting.load(Ordering::SeqCst)
    }

    pub fn set_quitting(&self, val: bool) {
        self.quitting.store(val, Ordering::SeqCst);
    }

    pub fn is_close_to_tray(&self) -> bool {
        self.close_to_tray.load(Ordering::SeqCst)
    }

    pub fn set_close_to_tray(&self, val: bool) {
        self.close_to_tray.store(val, Ordering::SeqCst);
    }

    pub fn get_locale(&self) -> String {
        lock_recover(&self.locale).clone()
    }

    pub fn set_locale(&self, loc: String) {
        *lock_recover(&self.locale) = loc;
    }

    // --- Sidecar ---

    pub fn get_sidecar(&self) -> Result<Arc<crate::sidecar::SidecarManager>, String> {
        lock_recover(&self.sidecar)
            .clone()
            .ok_or_else(|| "sidecar is not initialized".to_string())
    }

    pub fn set_sidecar(&self, manager: Arc<crate::sidecar::SidecarManager>) {
        *lock_recover(&self.sidecar) = Some(manager);
    }

    /// Get the cover sidecar, starting it lazily on first use.
    /// Falls back to an error if the cover script is missing — the caller
    /// should then fall back to the main sidecar's codec.
    pub fn get_cover_sidecar(&self) -> Result<Arc<crate::sidecar::SidecarManager>, String> {
        {
            let guard = lock_recover(&self.cover_sidecar);
            if let Some(mgr) = guard.clone() {
                return Ok(mgr);
            }
        }
        // Lazy start: create and start the cover sidecar on first artwork request.
        // Note: this is sync context; the actual start is async — we return an
        // error here and let the caller retry after spawning via command.
        Err("cover sidecar is not initialized".to_string())
    }

    pub fn set_cover_sidecar(&self, manager: Arc<crate::sidecar::SidecarManager>) {
        *lock_recover(&self.cover_sidecar) = Some(manager);
    }

    pub fn get_audio_engine(
        &self,
    ) -> Result<Arc<crate::audio::AudioEngineSupervisor>, String> {
        lock_recover(&self.audio_engine)
            .clone()
            .ok_or_else(|| "audio engine is not initialized".to_string())
    }

    pub fn set_audio_engine(&self, supervisor: Arc<crate::audio::AudioEngineSupervisor>) {
        *lock_recover(&self.audio_engine) = Some(supervisor);
    }

    // --- Sleep inhibition ---

    pub fn block_sleep(&self, id: u32) {
        lock_recover(&self.sleep_blockers).insert(id);
    }

    pub fn unblock_sleep(&self, id: u32) {
        lock_recover(&self.sleep_blockers).remove(&id);
    }

    pub fn is_sleep_blocked(&self) -> bool {
        !lock_recover(&self.sleep_blockers).is_empty()
    }

    // --- Hotkeys ---

    pub fn register_hotkey(&self, accel: String) {
        lock_recover(&self.registered_hotkeys).insert(accel);
    }

    pub fn unregister_hotkey(&self, accel: &str) {
        lock_recover(&self.registered_hotkeys).remove(accel);
    }

    pub fn unregister_all_hotkeys(&self) {
        lock_recover(&self.registered_hotkeys).clear();
    }

    pub fn has_hotkey(&self, accel: &str) -> bool {
        lock_recover(&self.registered_hotkeys).contains(accel)
    }

    pub fn set_media_keys_active(&self, active: bool) {
        self.media_keys_active.store(active, Ordering::SeqCst);
    }

    pub fn is_media_keys_active(&self) -> bool {
        self.media_keys_active.load(Ordering::SeqCst)
    }

    // --- Media session ---

    pub fn set_now_playing(&self, data: Option<serde_json::Value>) {
        *lock_recover(&self.current_now_playing) = data;
    }

    pub fn get_now_playing(&self) -> Option<serde_json::Value> {
        lock_recover(&self.current_now_playing).clone()
    }

    pub fn set_playback_state(&self, state: String) {
        *lock_recover(&self.current_playback_state) = state;
    }

    pub fn get_playback_state(&self) -> String {
        lock_recover(&self.current_playback_state).clone()
    }

    pub fn set_position_ms(&self, pos: f64) {
        *lock_recover(&self.current_position_ms) = pos;
    }

    pub fn get_position_ms(&self) -> f64 {
        *lock_recover(&self.current_position_ms)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sleep_inhibition_lifecycle() {
        let state = AppState::default();
        assert!(!state.is_sleep_blocked());

        state.block_sleep(1);
        state.block_sleep(2);
        assert!(state.is_sleep_blocked());

        state.unblock_sleep(1);
        assert!(state.is_sleep_blocked(), "still blocked by id 2");

        state.unblock_sleep(2);
        assert!(!state.is_sleep_blocked());
    }

    #[test]
    fn hotkeys_lifecycle() {
        let state = AppState::default();
        assert!(!state.is_media_keys_active());
        assert!(!state.has_hotkey("MediaPlayPause"));

        state.set_media_keys_active(true);
        state.register_hotkey("MediaPlayPause".to_string());
        state.register_hotkey("Ctrl+Alt+P".to_string());
        assert!(state.has_hotkey("MediaPlayPause"));

        state.unregister_hotkey("Ctrl+Alt+P");
        assert!(!state.has_hotkey("Ctrl+Alt+P"));

        state.unregister_all_hotkeys();
        assert!(!state.has_hotkey("MediaPlayPause"));
    }

    #[test]
    fn media_session_state() {
        let state = AppState::default();
        assert_eq!(state.get_playback_state(), "stopped");
        assert!(state.get_now_playing().is_none());

        state.set_playback_state("playing".to_string());
        state.set_now_playing(Some(serde_json::json!({
            "title": "Hyperballad",
            "artist": "Björk",
        })));

        assert_eq!(state.get_playback_state(), "playing");
        let np = state.get_now_playing().unwrap();
        assert_eq!(np["title"].as_str(), Some("Hyperballad"));
    }
}
