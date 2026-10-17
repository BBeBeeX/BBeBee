//! Shared application state for multi-window coordination, tray, and IPC.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

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

pub struct AppState {
    pub close_to_tray: AtomicBool,
    pub quitting: AtomicBool,
    pub locale: Mutex<String>,

    // Desktop lyrics
    pub latest_lyric_data: Mutex<Option<serde_json::Value>>,
    pub lyric_window_visible: AtomicBool,
    pub lyric_window_locked: AtomicBool,
    pub lyric_programmatic_move: AtomicBool,

    // Mini player
    pub latest_mini_player_data: Mutex<Option<serde_json::Value>>,
    pub mini_player_mode: Mutex<String>,
    pub mini_player_window_state: Mutex<String>,
    pub mini_player_last_floating_pos: Mutex<Option<(i32, i32)>>,
    pub mini_player_programmatic_move: AtomicBool,

    // Taskbar / Media
    pub taskbar_state: Mutex<TaskbarState>,

    // Power & Sleep Inhibition
    pub sleep_blockers: Mutex<std::collections::HashSet<u32>>,

    // System Hotkeys & Media Keys
    pub registered_hotkeys: Mutex<std::collections::HashSet<String>>,
    pub media_keys_active: AtomicBool,

    // Media Session State
    pub current_now_playing: Mutex<Option<serde_json::Value>>,
    pub current_playback_state: Mutex<String>,
    pub current_position_ms: Mutex<f64>,

    // Sidecar manager
    pub sidecar: Mutex<Option<Arc<crate::sidecar::SidecarManager>>>,
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

            taskbar_state: Mutex::new(TaskbarState::default()),
            sleep_blockers: Mutex::new(std::collections::HashSet::new()),
            registered_hotkeys: Mutex::new(std::collections::HashSet::new()),
            media_keys_active: AtomicBool::new(false),
            current_now_playing: Mutex::new(None),
            current_playback_state: Mutex::new("stopped".to_string()),
            current_position_ms: Mutex::new(0.0),
            sidecar: Mutex::new(None),
        }
    }
}

impl AppState {
    pub fn get_sidecar(&self) -> Result<Arc<crate::sidecar::SidecarManager>, String> {
        let guard = self.sidecar.lock().map_err(|e| e.to_string())?;
        guard.clone().ok_or_else(|| "Sidecar is not initialized".to_string())
    }

    pub fn set_sidecar(&self, manager: Arc<crate::sidecar::SidecarManager>) {
        let mut guard = self.sidecar.lock().unwrap();
        *guard = Some(manager);
    }

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
        self.locale.lock().unwrap().clone()
    }

    pub fn set_locale(&self, loc: String) {
        *self.locale.lock().unwrap() = loc;
    }

    pub fn block_sleep(&self, id: u32) {
        self.sleep_blockers.lock().unwrap().insert(id);
    }

    pub fn unblock_sleep(&self, id: u32) {
        self.sleep_blockers.lock().unwrap().remove(&id);
    }

    pub fn is_sleep_blocked(&self) -> bool {
        !self.sleep_blockers.lock().unwrap().is_empty()
    }

    pub fn register_hotkey(&self, accel: String) {
        self.registered_hotkeys.lock().unwrap().insert(accel);
    }

    pub fn unregister_hotkey(&self, accel: &str) {
        self.registered_hotkeys.lock().unwrap().remove(accel);
    }

    pub fn unregister_all_hotkeys(&self) {
        self.registered_hotkeys.lock().unwrap().clear();
    }

    pub fn has_hotkey(&self, accel: &str) -> bool {
        self.registered_hotkeys.lock().unwrap().contains(accel)
    }

    pub fn set_media_keys_active(&self, active: bool) {
        self.media_keys_active.store(active, Ordering::SeqCst);
    }

    pub fn is_media_keys_active(&self) -> bool {
        self.media_keys_active.load(Ordering::SeqCst)
    }

    pub fn set_now_playing(&self, data: Option<serde_json::Value>) {
        *self.current_now_playing.lock().unwrap() = data;
    }

    pub fn get_now_playing(&self) -> Option<serde_json::Value> {
        self.current_now_playing.lock().unwrap().clone()
    }

    pub fn set_playback_state(&self, state: String) {
        *self.current_playback_state.lock().unwrap() = state;
    }

    pub fn get_playback_state(&self) -> String {
        self.current_playback_state.lock().unwrap().clone()
    }

    pub fn set_position_ms(&self, pos: f64) {
        *self.current_position_ms.lock().unwrap() = pos;
    }

    pub fn get_position_ms(&self) -> f64 {
        *self.current_position_ms.lock().unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sleep_inhibition_lifecycle() {
        let state = AppState::default();
        assert!(!state.is_sleep_blocked());

        state.block_sleep(1);
        assert!(state.is_sleep_blocked());

        state.block_sleep(2);
        assert!(state.is_sleep_blocked());

        state.unblock_sleep(1);
        assert!(state.is_sleep_blocked(), "Should still be blocked by lock 2");

        state.unblock_sleep(2);
        assert!(!state.is_sleep_blocked(), "Should be unblocked when all locks released");
    }

    #[test]
    fn test_hotkeys_and_media_keys() {
        let state = AppState::default();
        assert!(!state.is_media_keys_active());
        assert!(!state.has_hotkey("MediaPlayPause"));

        state.set_media_keys_active(true);
        assert!(state.is_media_keys_active());

        state.register_hotkey("MediaPlayPause".to_string());
        state.register_hotkey("Ctrl+Alt+P".to_string());
        assert!(state.has_hotkey("MediaPlayPause"));
        assert!(state.has_hotkey("Ctrl+Alt+P"));

        state.unregister_hotkey("Ctrl+Alt+P");
        assert!(!state.has_hotkey("Ctrl+Alt+P"));
        assert!(state.has_hotkey("MediaPlayPause"));

        state.unregister_all_hotkeys();
        assert!(!state.has_hotkey("MediaPlayPause"));
    }

    #[test]
    fn test_media_session_metadata_and_state() {
        let state = AppState::default();
        assert_eq!(state.get_playback_state(), "stopped");
        assert!(state.get_now_playing().is_none());

        state.set_playback_state("playing".to_string());
        assert_eq!(state.get_playback_state(), "playing");

        state.set_now_playing(Some(serde_json::json!({
            "title": "Hyperballad",
            "artist": "Björk",
            "durationMs": 321000
        })));

        let np = state.get_now_playing().unwrap();
        assert_eq!(np.get("title").and_then(|t| t.as_str()), Some("Hyperballad"));
    }
}
