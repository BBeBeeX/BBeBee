//! Mini Player Window Manager
//!
//! Controls the Mini Player / Dynamic Island WebviewWindow.
//! Implements 3 display modes (normal: 380x96, attached: 280x50, expanded: 420x184),
//! snapping logic (TOP_SNAP_THRESHOLD = 80), and state synchronization.

use std::sync::atomic::Ordering;
use std::time::Duration;
use crate::error::lock_recover;
use tauri::{Emitter, Manager};

use crate::state::{AppState, MiniPlayerServiceState};

pub const TOP_SNAP_THRESHOLD: i32 = 80;

#[derive(Debug, Clone, Copy)]
pub struct Dims {
    pub width: i32,
    pub height: i32,
}

pub fn get_mode_dimensions(mode: &str) -> Dims {
    match mode {
        "attached" => Dims {
            width: 280,
            height: 50,
        },
        "expanded" => Dims {
            width: 420,
            height: 184,
        },
        _ => Dims {
            width: 380,
            height: 96,
        },
    }
}

pub fn get_or_create_mini_player_window(
    app: &tauri::AppHandle,
    state: &AppState,
) -> Result<tauri::WebviewWindow, String> {
    if let Some(win) = app.get_webview_window("mini-player") {
        return Ok(win);
    }

    let mode = lock_recover(\&state.mini_player_mode).clone();
    let dims = get_mode_dimensions(&mode);

    let mut initial_x = 100;
    let mut initial_y = 100;

    if let Ok(Some(primary)) = app.primary_monitor() {
        let m_pos = primary.position();
        let m_size = primary.size();
        let scale = primary.scale_factor();
        let mx = (m_pos.x as f64 / scale).round() as i32;
        let my = (m_pos.y as f64 / scale).round() as i32;
        let mw = (m_size.width as f64 / scale).round() as i32;
        let mh = (m_size.height as f64 / scale).round() as i32;

        if mode == "attached" || mode == "expanded" {
            initial_x = mx + (mw - dims.width) / 2;
            initial_y = my;
        } else if let Some((lx, ly)) = *lock_recover(\&state.mini_player_last_floating_pos) {
            initial_x = lx;
            initial_y = ly;
        } else {
            initial_x = mx + (mw - dims.width) / 2;
            initial_y = my + (mh as f64 * 0.2) as i32;
        }
    }

    let builder = tauri::WebviewWindowBuilder::new(
        app,
        "mini-player",
        tauri::WebviewUrl::App("index.html?window=mini-player#mini-player".into()),
    )
    .title("BBeBee Mini Player")
    .inner_size(dims.width as f64, dims.height as f64)
    .position(initial_x as f64, initial_y as f64)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .initialization_script(include_str!("shim.js"))
    .visible(false);

    let win = builder.build().map_err(|e| e.to_string())?;
    let _ = win.set_always_on_top(true);

    Ok(win)
}

pub fn get_service_state(app: &tauri::AppHandle, state: &AppState) -> MiniPlayerServiceState {
    let visible = app
        .get_webview_window("mini-player")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);

    let mode = lock_recover(\&state.mini_player_mode).clone();
    let win_state = if visible {
        lock_recover(\&state.mini_player_window_state).clone()
    } else {
        "hidden".to_string()
    };

    MiniPlayerServiceState {
        visible,
        mode,
        window_state: win_state,
    }
}

pub fn notify_mini_player_state(app: &tauri::AppHandle, state: &AppState) {
    let service_state = get_service_state(app, state);
    if let Some(win) = app.get_webview_window("mini-player") {
        let _ = win.emit("mini-player:state", &service_state);
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("mini-player:state", &service_state);
    }
}

pub fn apply_mode_bounds(
    app: &tauri::AppHandle,
    state: &AppState,
    mode: &str,
) -> Result<(), String> {
    let Some(win) = app.get_webview_window("mini-player") else {
        return Ok(());
    };

    state
        .mini_player_programmatic_move
        .store(true, Ordering::SeqCst);
    let dims = get_mode_dimensions(mode);

    let scale = win.scale_factor().unwrap_or(1.0);
    let cur_pos = win
        .outer_position()
        .map(|p| (p.x as f64 / scale, p.y as f64 / scale))
        .unwrap_or((100.0, 100.0));

    let mut target_x = cur_pos.0 as i32;
    let mut target_y = cur_pos.1 as i32;

    if let Ok(Some(m)) = win.current_monitor() {
        let m_pos = m.position();
        let m_size = m.size();
        let m_scale = m.scale_factor();
        let mx = (m_pos.x as f64 / m_scale).round() as i32;
        let my = (m_pos.y as f64 / m_scale).round() as i32;
        let mw = (m_size.width as f64 / m_scale).round() as i32;
        let mh = (m_size.height as f64 / m_scale).round() as i32;

        if mode == "attached" || mode == "expanded" {
            target_x = mx + (mw - dims.width) / 2;
            target_y = my;
            *lock_recover(\&state.mini_player_window_state) = mode.to_string();
        } else {
            *lock_recover(\&state.mini_player_window_state) = "normal".to_string();
            if let Some((lx, ly)) = *lock_recover(\&state.mini_player_last_floating_pos) {
                target_x = lx.max(mx).min(mx + mw - dims.width);
                target_y = ly.max(my + 40).min(my + mh - dims.height);
            } else {
                target_x = mx + (mw - dims.width) / 2;
                target_y = my + (mh as f64 * 0.25) as i32;
            }
        }
    }

    let _ = win.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
        dims.width as f64,
        dims.height as f64,
    )));
    let _ = win.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(
        target_x as f64,
        target_y as f64,
    )));

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let s = handle.state::<AppState>();
        s.mini_player_programmatic_move
            .store(false, Ordering::SeqCst);
    });

    Ok(())
}

pub fn calculate_snap_transition(
    current_mode: &str,
    distance_to_top: i32,
) -> Option<&'static str> {
    if current_mode == "normal" {
        if distance_to_top <= TOP_SNAP_THRESHOLD {
            Some("attached")
        } else {
            None
        }
    } else if (current_mode == "attached" || current_mode == "expanded") && distance_to_top > 40 {
        Some("normal")
    } else {
        None
    }
}

pub fn handle_mini_player_moved(app: &tauri::AppHandle, state: &AppState) {
    if state
        .mini_player_programmatic_move
        .load(Ordering::SeqCst)
    {
        return;
    }

    let Some(win) = app.get_webview_window("mini-player") else {
        return;
    };

    let scale = win.scale_factor().unwrap_or(1.0);
    let Ok(pos) = win.outer_position() else {
        return;
    };
    let x = (pos.x as f64 / scale).round() as i32;
    let y = (pos.y as f64 / scale).round() as i32;

    let Some(m) = win.current_monitor().ok().flatten() else {
        return;
    };
    let m_pos = m.position();
    let m_scale = m.scale_factor();
    let my = (m_pos.y as f64 / m_scale).round() as i32;

    let distance_to_top = y - my;
    let current_mode = lock_recover(\&state.mini_player_mode).clone();

    if let Some(target_mode) = calculate_snap_transition(&current_mode, distance_to_top) {
        if target_mode == "normal" {
            *lock_recover(\&state.mini_player_last_floating_pos) = Some((x, y));
        }
        *lock_recover(\&state.mini_player_mode) = target_mode.to_string();
        let _ = apply_mode_bounds(app, state, target_mode);
        notify_mini_player_state(app, state);
    } else if current_mode == "normal" {
        *lock_recover(\&state.mini_player_last_floating_pos) = Some((x, y));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mode_dimensions() {
        let normal = get_mode_dimensions("normal");
        assert_eq!(normal.width, 380);
        assert_eq!(normal.height, 96);

        let attached = get_mode_dimensions("attached");
        assert_eq!(attached.width, 280);
        assert_eq!(attached.height, 50);

        let expanded = get_mode_dimensions("expanded");
        assert_eq!(expanded.width, 420);
        assert_eq!(expanded.height, 184);

        let fallback = get_mode_dimensions("unknown");
        assert_eq!(fallback.width, 380);
        assert_eq!(fallback.height, 96);
    }

    #[test]
    fn test_snapping_logic() {
        // In normal mode: if distance <= 80, snap to attached
        assert_eq!(calculate_snap_transition("normal", 80), Some("attached"));
        assert_eq!(calculate_snap_transition("normal", 10), Some("attached"));
        assert_eq!(calculate_snap_transition("normal", 0), Some("attached"));
        assert_eq!(calculate_snap_transition("normal", 81), None);
        assert_eq!(calculate_snap_transition("normal", 150), None);

        // In attached / expanded mode: if distance > 40, detach into normal
        assert_eq!(calculate_snap_transition("attached", 41), Some("normal"));
        assert_eq!(calculate_snap_transition("attached", 100), Some("normal"));
        assert_eq!(calculate_snap_transition("attached", 40), None);
        assert_eq!(calculate_snap_transition("attached", 0), None);

        assert_eq!(calculate_snap_transition("expanded", 41), Some("normal"));
        assert_eq!(calculate_snap_transition("expanded", 40), None);
    }
}
